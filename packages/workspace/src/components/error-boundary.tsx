import { Component, type ReactNode } from "react";

import { Button } from "@repo/ui/components/button";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 font-mono text-sm">
        <div className="text-destructive-foreground">Something went wrong</div>
        <pre className="max-w-lg overflow-auto rounded bg-secondary p-4 text-xs text-muted-foreground">
          {this.state.error.message}
        </pre>
        <Button
          variant="outline"
          onClick={() => this.setState({ error: null })}
          className="text-xs"
        >
          Try again
        </Button>
      </div>
    );
  }
}
