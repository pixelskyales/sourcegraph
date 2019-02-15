package symbols

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/sourcegraph/sourcegraph/pkg/api"

	"github.com/sourcegraph/sourcegraph/pkg/pathmatch"

	opentracing "github.com/opentracing/opentracing-go"
	"github.com/opentracing/opentracing-go/ext"
	otlog "github.com/opentracing/opentracing-go/log"
	"github.com/sourcegraph/sourcegraph/pkg/symbols/protocol"
	"golang.org/x/net/trace"
	log15 "gopkg.in/inconshreveable/log15.v2"
)

// maxFileSize is the limit on file size in bytes. Only files smaller than this are processed.
const maxFileSize = 1 << 19 // 512KB

func (s *Service) handleSearch(w http.ResponseWriter, r *http.Request) {
	var args protocol.SearchArgs
	if err := json.NewDecoder(r.Body).Decode(&args); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	result, err := s.search(r.Context(), args)
	if err != nil {
		if err == context.Canceled && r.Context().Err() == context.Canceled {
			return // client went away
		}
		log15.Error("Symbol search failed", "args", args, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := json.NewEncoder(w).Encode(result); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func (s *Service) search(ctx context.Context, args protocol.SearchArgs) (result *protocol.SearchResult, err error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	log15.Debug("Symbol search", "repo", args.Repo, "query", args.Query)

	span, ctx := opentracing.StartSpanFromContext(ctx, "search")
	span.SetTag("repo", args.Repo)
	span.SetTag("commitID", args.CommitID)
	span.SetTag("query", args.Query)
	span.SetTag("first", args.First)
	defer func() {
		if err != nil {
			ext.Error.Set(span, true)
			span.LogFields(otlog.Error(err))
		}
		span.Finish()
	}()

	tr := trace.New("symbols.search", fmt.Sprintf("args:%+v", args))
	defer func() {
		if err != nil {
			tr.LazyPrintf("error: %v", err)
			tr.SetError()
		}
		tr.Finish()
	}()

	repoCommit := RepoCommit{
		RepoName: args.Repo,
		CommitID: args.CommitID,
	}
	fmt.Println(s.dbFilePath(repoCommit))
	// TODO ensure that a concurrent search request doesn't trigger redundant indexing
	// TODO measure perf loss due to opening the .sqlite file for each query
	// index unless already indexed

	db, err := sqlx.Open("sqlite3_with_pcre", s.dbFilePath(repoCommit))
	defer db.Close()
	if err != nil {
		return nil, err
	}

	inFlightMutex.Lock()
	if _, ok := inFlight[repoCommit]; !ok {
		fmt.Println("Adding to inFlight ➕")
		inFlight[repoCommit] = &IndexingState{
			Mutex: &sync.Mutex{},
			Error: nil,
		}
	}
	inFlight[repoCommit].Mutex.Lock()
	inFlightMutex.Unlock()

	if _, err := db.Exec(`SELECT 1 FROM symbols LIMIT 1;`); err != nil {
		fmt.Println("Indexing 📝")
		inFlight[repoCommit].Error = s.writeSymbols(ctx, db, args)
	}
	inFlight[repoCommit].Mutex.Unlock()

	if inFlight[repoCommit].Error != nil {
		return nil, inFlight[repoCommit].Error
	}

	fmt.Println("Searching 🔍")

	result = &protocol.SearchResult{}
	res, err := filterSymbols(ctx, db, args)
	if err != nil {
		return nil, err
	}
	result.Symbols = res
	return result, nil
}

func filterSymbols(ctx context.Context, db *sqlx.DB, args protocol.SearchArgs) (res []protocol.Symbol, err error) {
	start := time.Now()
	defer func() {
		fmt.Printf("filterSymbols %.3f\n", time.Now().Sub(start).Seconds())
	}()
	span, _ := opentracing.StartSpanFromContext(ctx, "filterSymbols")
	defer func() {
		if err != nil {
			ext.Error.Set(span, true)
			span.LogFields(otlog.Error(err))
		}
		span.Finish()
	}()

	query := args.Query
	if !args.IsRegExp {
		query = regexp.QuoteMeta(query)
	}
	if !args.IsCaseSensitive {
		query = "(?i:" + query + ")"
	}
	queryRegex, err := regexp.Compile(query)
	if err != nil {
		return nil, err
	}

	fileFilter, err := pathmatch.CompilePathPatterns(args.IncludePatterns, args.ExcludePattern, pathmatch.CompileOptions{
		CaseSensitive: args.IsCaseSensitive,
		RegExp:        args.IsRegExp,
	})
	if err != nil {
		return nil, err
	}
	fmt.Println("fileFilter.String()", fileFilter.String())
	fmt.Println("queryRegex", queryRegex)

	const maxFirst = 500
	if args.First < 0 || args.First > maxFirst {
		args.First = maxFirst
	}
	err = db.Select(&res, "SELECT * FROM symbols WHERE name REGEXP $1 AND path REGEXP $2 LIMIT $3", queryRegex.String(), fileFilter.String(), maxFirst)
	if err != nil {
		return nil, err
	}

	span.SetTag("hits", len(res))
	return res, nil
}

const symbolsDbVersion = 1

func (s *Service) dbFilePath(repoCommit RepoCommit) string {
	return path.Join(s.Path, fmt.Sprintf("v%d-%s@%s.sqlite", symbolsDbVersion, strings.Replace(string(repoCommit.RepoName), "/", "-", -1), repoCommit.CommitID))
}

type RepoCommit struct {
	RepoName api.RepoName
	CommitID api.CommitID
}

type IndexingState struct {
	Mutex *sync.Mutex
	Error error
}

var inFlightMutex = &sync.Mutex{}
var inFlight = map[RepoCommit]*IndexingState{}

func (s *Service) writeSymbols(ctx context.Context, db *sqlx.DB, args protocol.SearchArgs) error {
	symbols, err := s.parseUncached(ctx, args.Repo, args.CommitID)

	if err != nil {
		return err
	}

	tx, err := db.Beginx()
	if err != nil {
		return err
	}

	_, err = tx.Exec(
		`CREATE TABLE IF NOT EXISTS symbols (
			name VARCHAR(256) NOT NULL,
			path VARCHAR(4096) NOT NULL,
			line INT NOT NULL,
			kind VARCHAR(255) NOT NULL,
			language VARCHAR(255) NOT NULL,
			parent VARCHAR(255) NOT NULL,
			parent_kind VARCHAR(255) NOT NULL,
			signature VARCHAR(255) NOT NULL,
			pattern VARCHAR(255) NOT NULL,
			file_limited BOOLEAN NOT NULL
		)`)
	if err != nil {
		return err
	}

	for _, symbol := range symbols {
		_, err := tx.NamedExec("INSERT INTO symbols (name, path, line, kind, language, parent, parent_kind, signature, pattern, file_limited) VALUES (:name, :path, :line, :kind, :language, :parent, :parent_kind, :signature, :pattern, :file_limited)", &symbol)
		if err != nil {
			return err
		}
	}
	err = tx.Commit()
	if err != nil {
		return err
	}

	return nil
}
