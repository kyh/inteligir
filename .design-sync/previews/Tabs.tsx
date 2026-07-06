import { Tabs, TabsList, TabItem, TabPanel } from "@repo/ui";
import { FileText, Eye, Link2, Settings, Sparkles, FolderOpen } from "lucide-react";

const panelStyle = { paddingTop: 14, fontSize: 13, lineHeight: 1.5, maxWidth: 340 };

export function EditorTabs() {
  return (
    <Tabs defaultValue="editor">
      <TabsList>
        <TabItem value="editor" label="Editor" icon={FileText} />
        <TabItem value="preview" label="Preview" icon={Eye} />
        <TabItem value="backlinks" label="Backlinks" icon={Link2} />
      </TabsList>
      <TabPanel value="editor" style={panelStyle}>
        Draft the Q3 roadmap in markdown and link the related meeting notes as you write.
      </TabPanel>
      <TabPanel value="preview" style={panelStyle}>
        Rendered preview of the current note, wiki-links and math resolved.
      </TabPanel>
      <TabPanel value="backlinks" style={panelStyle}>
        4 notes link here, including Launch checklist and Weekly sync.
      </TabPanel>
    </Tabs>
  );
}

export function SettingsTabs() {
  return (
    <Tabs defaultValue="ai">
      <TabsList>
        <TabItem value="general" label="General" icon={Settings} />
        <TabItem value="ai" label="Editor AI" icon={Sparkles} />
        <TabItem value="vault" label="Vault" icon={FolderOpen} />
      </TabsList>
      <TabPanel value="general" style={panelStyle}>
        Appearance, theme, and keyboard shortcuts for the workspace.
      </TabPanel>
      <TabPanel value="ai" style={panelStyle}>
        Ghost-text completions are on by default. Choose the model used for inline AI edits.
      </TabPanel>
      <TabPanel value="vault" style={panelStyle}>
        ~/Notes is the active vault. Markdown files stay on disk and are yours.
      </TabPanel>
    </Tabs>
  );
}
