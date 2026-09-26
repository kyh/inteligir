import { Button } from "@repo/ui/components/button";

export const WelcomeStep = ({ onStart }: { onStart: () => void }) => (
  <div className="flex flex-col items-center gap-3 text-center">
    <h1 className="text-display">Inteligir</h1>
    <p className="max-w-sm text-subtitle text-muted-foreground">
      Your notes, on your Mac, with an agent that edits them alongside you.
    </p>
    <Button className="mt-3" onClick={onStart}>
      Get started
    </Button>
  </div>
);
