export const RailReadFailed = ({
  sentence,
  onRetry,
}: {
  sentence: string;
  onRetry: () => void;
}) => (
  <div className="px-2 py-2 text-body">
    <p className="text-destructive">{sentence}</p>
    <button
      type="button"
      onClick={onRetry}
      className="mt-1 rounded px-1 py-0.5 text-muted-foreground underline underline-offset-2 hover:text-foreground"
    >
      Try again
    </button>
  </div>
);
