import { EditorView, keymap, lineNumbers, highlightActiveLine,
         highlightSpecialChars, drawSelection, placeholder } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, bracketMatching, foldGutter, foldKeymap,
         syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { autocompletion, completionKeymap, closeBrackets } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { cpp } from "@codemirror/lang-cpp";
import { tags } from "@lezer/highlight";

const cSyntax = HighlightStyle.define([
  { tag: tags.comment, color: "#6b7a8f", fontStyle: "italic" },
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: "#1f6feb" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.propertyName], color: "#9538b8" },
  { tag: [tags.number, tags.bool, tags.null], color: "#cc4a12" },
  { tag: [tags.string, tags.special(tags.string)], color: "#0a7d3c" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#6840d6" },
  { tag: [tags.definition(tags.variableName), tags.variableName, tags.local(tags.variableName)], color: "#171b22" },
  { tag: [tags.macroName, tags.constant(tags.variableName)], color: "#a12b5e" }
]);

const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "14px" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    lineHeight: "1.5"
  },
  ".cm-content": { padding: "10px 4px" },
  ".cm-gutters": {
    backgroundColor: "#fbfcfe",
    borderRight: "1px solid #eef1f5"
  },
  ".cm-activeLine": { backgroundColor: "#f2f7ff" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "#cfe3ff" }
});

function createEditor(parent, options) {
  if (parent.view) {
    parent.view.destroy();
  }
  const state = EditorState.create({
    doc: options.content || "",
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      foldGutter(),
      autocompletion(),
      highlightSelectionMatches(),
      placeholder("// Skriv din C-kod här…"),
      keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap, ...foldKeymap, ...searchKeymap,
        indentWithTab,
        { key: "Mod-s", preventDefault: true, run: () => { options.onSave && options.onSave(); return true; } },
        { key: "Mod-Enter", preventDefault: true, run: () => { options.onRun && options.onRun(); return true; } }
      ]),
      cpp(),
      syntaxHighlighting(cSyntax),
      editorTheme,
      readOnlyCompartment.of(EditorState.readOnly.of(false)),
      EditorView.lineWrapping,
      EditorView.updateListener.of(update => {
        if (update.docChanged)
          options.onChange && options.onChange();
      })
    ]
  });

  const view = new EditorView({ state, parent });
  parent.view = view;
  return view;
}

function setContent(view, content) {
  if (!view)
    return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content || "" } });
}

function getContent(view) {
  return view ? view.state.doc.toString() : "";
}

function setReadOnly(view, ro) {
  if (!view)
    return;
  view.dispatch({
    effects: readOnlyCompartment.reconfigure(
      ro ? EditorState.readOnly.of(true) : EditorState.readOnly.of([])
    )
  });
}

const readOnlyCompartment = new Compartment();

globalThis.AiProffsEditor = {
  createEditor,
  setContent,
  getContent,
  setReadOnly
};