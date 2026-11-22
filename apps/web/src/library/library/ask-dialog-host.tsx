import { Button } from "@repo/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useStore } from "zustand";

import { useLibraryQueries } from "../cloud/library-context";
import { folderPaths } from "../sidebar/folder-paths";
import { asks, dismissAsk } from "./ask";
import type { Ask } from "./ask";

const FolderForm = ({ ask }: { ask: Extract<Ask, { kind: "parent" }> }) => {
  const folders = useQuery(useLibraryQueries().scopes()).data?.containers ?? [];

  return (
    <>
      <DialogTitle>
        {ask.count === 1 ? "Move to" : `Move ${String(ask.count)} items to`}
      </DialogTitle>
      <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
        {[{ id: null, label: "No folder (Unsorted)" }, ...folderPaths(folders)].map((choice) => (
          <Button
            key={choice.id ?? "none"}
            variant="ghost"
            className="justify-start"
            onClick={() => {
              ask.answer({ parentId: choice.id });
            }}
          >
            {choice.label}
          </Button>
        ))}
      </div>
    </>
  );
};

const cleanTag = (raw: string) => raw.trim().replace(/^#/u, "").replaceAll(/\s+/gu, "-");

const TagsForm = ({ ask }: { ask: Extract<Ask, { kind: "tags" }> }) => {
  const [draft, setDraft] = useState("");

  return (
    <>
      <DialogTitle>{ask.count === 1 ? "Tag" : `Tag ${String(ask.count)} items`}</DialogTitle>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const tag = cleanTag(draft);

          if (tag !== "") {
            ask.answer({ add: [tag], remove: [] });
          }
        }}
      >
        <Input
          aria-label="Tag to add"
          placeholder="Add a tag"
          value={draft}
          autoFocus
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <Button type="submit" disabled={cleanTag(draft) === ""}>
          Add
        </Button>
      </form>
      {ask.held.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5">
          {ask.held.map((tag) => (
            <Button
              key={tag}
              size="compact"
              variant="secondary"
              aria-label={`Remove the tag ${tag}`}
              onClick={() => {
                ask.answer({ add: [], remove: [tag] });
              }}
            >
              #{tag} ×
            </Button>
          ))}
        </div>
      )}
    </>
  );
};

const NameForm = ({ ask }: { ask: Extract<Ask, { kind: "name" }> }) => {
  const [draft, setDraft] = useState(ask.initial);
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <>
      <DialogTitle>{ask.title}</DialogTitle>
      <DialogDescription>{ask.label}</DialogDescription>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const name = draft.trim();

          if (name === "") {
            return;
          }

          const refused = ask.refuse?.(name) ?? null;
          setRefusal(refused);

          if (refused === null) {
            ask.answer(name);
          }
        }}
      >
        <Input
          aria-label={ask.label}
          value={draft}
          autoFocus
          onChange={(event) => {
            setDraft(event.target.value);
            setRefusal(null);
          }}
        />
        <Button type="submit" disabled={draft.trim() === ""}>
          {ask.confirm}
        </Button>
      </form>
      {refusal === null ? null : (
        <p role="alert" className="m-0 text-body text-destructive">
          {refusal}
        </p>
      )}
    </>
  );
};

const AskForm = ({ ask }: { ask: Ask }) => {
  switch (ask.kind) {
    case "parent": {
      return <FolderForm ask={ask} />;
    }

    case "tags": {
      return <TagsForm ask={ask} />;
    }

    case "name": {
      return <NameForm ask={ask} />;
    }

    default: {
      throw new Error(`unexpected ${String(ask satisfies never)}`);
    }
  }
};

export const AskDialogHost = () => {
  const { made, standing } = useStore(asks);
  useEffect(() => dismissAsk, []);

  return (
    <Dialog
      open={standing !== null}
      onOpenChange={(open) => {
        if (!open) {
          dismissAsk();
        }
      }}
    >
      <DialogContent>
        {standing === null ? null : <AskForm key={made} ask={standing} />}
      </DialogContent>
    </Dialog>
  );
};
