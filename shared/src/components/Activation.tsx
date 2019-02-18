import H from 'history'
import CheckboxBlankCircleOutlineIcon from 'mdi-react/CheckboxBlankCircleOutlineIcon'
import CheckboxMarkedCircleOutlineIcon from 'mdi-react/CheckboxMarkedCircleOutlineIcon'
import RocketIcon from 'mdi-react/RocketIcon'
import * as React from 'react'
import CircularProgressbar from 'react-circular-progressbar'
import Confetti from 'react-dom-confetti'
import { BehaviorSubject, Observable, Subscription } from 'rxjs'
import { first } from 'rxjs/operators'
import { Props as CommandListProps } from '../commandPalette/CommandList'
import { PopoverButton } from './PopoverButton'

export interface ActivationStep {
    id: string
    title: string
    detail: string
    action: (h: H.History) => void
}

export class ActivationStatus {
    /**
     * Props
     */
    private steps_: ActivationStep[]
    private fetchCompleted: () => Observable<{ [key: string]: boolean }>

    /**
     * State
     */
    private completed_: BehaviorSubject<{ [key: string]: boolean } | null>

    constructor(steps: ActivationStep[], fetchCompleted: () => Observable<{ [key: string]: boolean }>) {
        this.steps_ = steps
        this.fetchCompleted = fetchCompleted
        this.completed_ = new BehaviorSubject<{ [key: string]: boolean } | null>(null)
    }

    public get steps(): ActivationStep[] {
        return this.steps_
    }

    public get completed(): BehaviorSubject<{ [key: string]: boolean } | null> {
        return this.completed_
    }

    public ensureInit(): void {
        if (!this.completed.value) {
            this.update(null)
        }
    }

    public update(u: { [key: string]: boolean } | null): void {
        if (!u) {
            this.fetchCompleted()
                .pipe(first()) // subscription will get auto-cleaned up
                .subscribe(res => {
                    const nextCompleted: { [key: string]: boolean } = {}
                    for (const step of this.steps) {
                        nextCompleted[step.id] = res[step.id] || false
                    }
                    this.completed.next(nextCompleted)
                })
        } else {
            if (!this.completed.value) {
                return
            }
            const newVal: { [key: string]: boolean } = {}
            Object.assign(newVal, this.completed.value)
            for (const step of this.steps) {
                if (u[step.id] !== undefined) {
                    newVal[step.id] = u[step.id]
                }
            }
            this.completed.next(newVal)
        }
    }
}

//////////////////////////////////////////////////////////////////////////////////

// TODO(beyang): rename

interface SiteAdminActivationPopoverButtonProps extends CommandListProps {
    history: H.History
    activation: ActivationStatus
}
interface SiteAdminActivationPopoverButtonState {
    completed?: { [key: string]: boolean }
}

/**
 * SiteAdminActivationPopoverButton is the nav bar button that opens the site admin
 * activation checklist as a dropdown.
 */
export class SiteAdminActivationPopoverButton extends React.PureComponent<
    SiteAdminActivationPopoverButtonProps,
    SiteAdminActivationPopoverButtonState
> {
    private subscriptions = new Subscription()

    constructor(props: SiteAdminActivationPopoverButtonProps) {
        super(props)
        this.state = {}
    }

    public componentDidMount(): void {
        this.subscriptions.add(
            this.props.activation.completed.subscribe(completed => {
                if (completed) {
                    this.setState({ completed })
                }
            })
        )
        this.props.activation.update(null)
    }

    public componentWillUnmount(): void {
        this.subscriptions.unsubscribe()
    }

    public render(): JSX.Element | null {
        return (
            <div>
                <PopoverButton
                    className="onboarding-button"
                    {...this.state}
                    popoverClassName="rounded"
                    placement="auto-end"
                    hideOnChange={true}
                    hideCaret={true}
                    popoverElement={
                        <SiteAdminActivationPopoverDropdown
                            steps={this.props.activation.steps}
                            history={this.props.history}
                            {...this.state}
                        />
                    }
                >
                    <span className="link-like">Setup</span>
                    <div className={`progress-bar-container ${this.state.completed ? '' : 'hidden'}`}>
                        <CircularProgressbar strokeWidth={12} percentage={percentageDone(this.state.completed)} />
                    </div>
                </PopoverButton>
            </div>
        )
    }
}

/**
 * SiteAdminActivationPopoverDropdown presents the site admin activation checklist
 * in a navbar dropdown.
 */
export class SiteAdminActivationPopoverDropdown extends React.PureComponent<SiteAdminChecklistProps, {}> {
    public render(): JSX.Element {
        return (
            <div className="onboarding-container command-list list-group list-group-flush rounded">
                <div className="list-group-item">
                    <div className="header">
                        <h2>
                            <RocketIcon className="icon-inline" /> Hi there!
                        </h2>
                        <p>
                            This is the Sourcegraph Quick Start Guide. Complete the steps below to finish setting up
                            your Sourcegraph instance.
                        </p>
                    </div>
                </div>
                <div className="list-group-item">{<SiteAdminChecklist {...this.props} />}</div>
            </div>
        )
    }
}

interface SiteAdminChecklistProps {
    history: H.History
    steps: ActivationStep[]
    completed?: { [key: string]: boolean }
}

/**
 * SiteAdminChecklist renders the site admin activation checklist.
 */
export class SiteAdminChecklist extends React.PureComponent<SiteAdminChecklistProps, {}> {
    public render(): JSX.Element {
        return (
            <div className="site-admin-checklist-container">
                {this.props.completed ? (
                    <ul className="site-admin-checklist">
                        {this.props.steps.map(s => (
                            <li key={s.id}>
                                <ChecklistItem
                                    {...s}
                                    history={this.props.history}
                                    done={(this.props.completed && this.props.completed[s.id]) || false}
                                />
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div>Loading...</div>
                )}
            </div>
        )
    }
}

interface ChecklistItemProps extends ActivationStep {
    done: boolean
    history: H.History
}

/**
 * ChecklistItem is a single item in the site admin activation checklist.
 */
class ChecklistItem extends React.PureComponent<ChecklistItemProps, {}> {
    private doAction = () => this.props.action(this.props.history)

    public render(): JSX.Element {
        return (
            <div className="item-container" onClick={this.doAction} data-tooltip={this.props.detail}>
                <p className="item-title">
                    {this.props.done ? (
                        <CheckboxMarkedCircleOutlineIcon className="icon-inline done" />
                    ) : (
                        <CheckboxBlankCircleOutlineIcon className="icon-inline todo" />
                    )}
                    &nbsp;&nbsp;
                    {this.props.title}
                    &nbsp;
                </p>
            </div>
        )
    }
}

/**
 * percentageDone returns the percent of activation checklist items completed.
 */
const percentageDone = (info?: { [key: string]: boolean }): number => {
    if (!info) {
        return 0
    }
    const vals = Object.values(info)
    return (100 * vals.filter(e => e).length) / vals.length
}

////////////////////////////////////////////////////////

interface ActivateConfettiState {
    activated?: boolean
    animate?: boolean
}

interface ActivateConfettiProps {
    activation?: ActivationStatus
    activationKeys: string[]
    pauseAndRetrigger?: () => void
}

export class ActivateConfetti extends React.PureComponent<ActivateConfettiProps, ActivateConfettiState> {
    private subscriptions = new Subscription()

    constructor(props: ActivateConfettiProps) {
        super(props)
        this.state = {}
    }

    public componentDidMount(): void {
        if (this.props.activation) {
            this.subscriptions.add(
                this.props.activation.completed.subscribe(completed => {
                    if (!completed) {
                        return
                    }

                    // Completed list is available, so now determine whether it's activated by looking at what's completed
                    let activated = true
                    for (const k of this.props.activationKeys) {
                        if (completed[k] === undefined) {
                            // ignore keys that aren't in completed
                            continue
                        }
                        if (!completed[k]) {
                            activated = false
                            break
                        }
                    }
                    this.setState({ activated })
                })
            )
        }
    }

    public componentWillUnmount(): void {
        this.subscriptions.unsubscribe()
    }

    private clicked = (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
        if (!this.props.activation) {
            return
        }
        if (this.state.activated === undefined) {
            return
        }
        if (this.state.activated) {
            return
        }

        // Activation is occurring
        const activatePatch: { [key: string]: boolean } = {}
        for (const k of this.props.activationKeys) {
            activatePatch[k] = true
        }
        this.props.activation.update(activatePatch)
        if (this.props.pauseAndRetrigger) {
            e.preventDefault()
            e.stopPropagation()
            setTimeout(this.props.pauseAndRetrigger, 1000)
        }
        this.setState({ activated: true, animate: !this.state.activated })
    }

    public render(): JSX.Element | null {
        return (
            <div onClick={this.clicked} className={`first-use-button ${this.state.animate ? 'animate' : ''}`}>
                {this.props.children}
            </div>
        )
    }
}
