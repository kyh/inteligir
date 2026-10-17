import { Button } from "@repo/ui/components/button";

export const WelcomeStep = ({ onStart }: { onStart: () => void }) => (
  <div className="flex flex-col items-center gap-3 text-center">
    <h1 className="text-display">Inteligir</h1>
    <p className="max-w-sm text-subtitle text-muted-foreground">
      Everything you save and write, in one library on your Mac, with an agent that files and edits
      it with you.
    </p>
    <Button className="mt-3" onClick={onStart}>
      Get started
    </Button>
  </div>
);
