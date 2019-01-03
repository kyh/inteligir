import React, { Component } from 'react';
import Editor from 'draft-js-plugins-editor';
import createMarkdownShortcutsPlugin from 'draft-js-markdown-shortcuts-plugin';
import { EditorState } from 'draft-js';
import createInlineToolbarPlugin from 'draft-js-inline-toolbar-plugin';
import createLinkPlugin from 'draft-js-anchor-plugin';
import { ItalicButton, BoldButton, UnderlineButton } from 'draft-js-buttons';
import './LessonEditor.css';

import 'draft-js-inline-toolbar-plugin/lib/plugin.css';

const linkPlugin = createLinkPlugin();
const inlineToolbarPlugin = createInlineToolbarPlugin({
  structure: [BoldButton, ItalicButton, UnderlineButton, linkPlugin.LinkButton],
});
const { InlineToolbar } = inlineToolbarPlugin;
const markdownShortcutsPlugin = createMarkdownShortcutsPlugin();

const plugins = [inlineToolbarPlugin, linkPlugin, markdownShortcutsPlugin];

export default class LessonEditor extends Component {
  state = {
    editorState: EditorState.createEmpty(),
  };

  onChange = (editorState) => {
    this.setState({
      editorState,
    });
  };

  render() {
    return [
      <Editor
        editorState={this.state.editorState}
        onChange={this.onChange}
        plugins={plugins}
      />,
      <InlineToolbar />,
    ];
  }
}
