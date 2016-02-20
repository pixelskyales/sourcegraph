var React = require("react");
var router = require("../routing/router");
var Person = require("../Person");

var DeltaClient = React.createClass({
	getInitialState() {
		return {};
	},
	render() {
		var dc = this.props.deltaClient;
		return (
			<li className="list-group-item">
			<img src={dc.AvatarURL} className="pull-left media-object avatar img-rounded" width="40" />
				<div className="media-body">
					<h3><span className="affected pull-left">{Person.label(dc)}</span> &nbsp;uses:</h3>
					<ul className="list-group defs">
						{dc.Defs.map(function(def) {
							var df = def.FmtStrings;
							return (
								<li key={def.Path} className="list-group-item">
									<code>{df.DefKeyword} <a className="defn-popover" href={router.defURL(def.Repo, def.CommitID, def.UnitType, def.Unit, def.Path)}><span className="name">{df.Name.DepQualified}</span>{df.NameAndTypeSeparator}{df.Type.DepQualified}</a></code>
								</li>
							);
						})}
					</ul>
				</div>
			</li>
		);
	},
});

module.exports = DeltaClient;
