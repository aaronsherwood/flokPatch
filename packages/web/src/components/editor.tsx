import { useQuery } from "@/hooks/use-query";
import { loadFont } from "@/lib/fonts";
import themes from "@/lib/themes";
import {
  langByTarget as langByTargetUntyped,
  noAutoIndent,
  noLineEval,
  panicCodes as panicCodesUntyped,
  targetsWithDocumentEvalMode,
  webTargets,
} from "@/settings.json";
import { insertNewline, toggleLineComment } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers as lineNumbersExtension,
} from "@codemirror/view";
import { evalKeymap, flashField, remoteEvalFlash } from "@flok-editor/cm-eval";
import { punctual } from "@flok-editor/lang-punctual";
import { tidal } from "@flok-editor/lang-tidal";
import { zwirn } from "@flok-editor/lang-zwirn";
import type { Document } from "@flok-editor/session";
import { vim } from "@replit/codemirror-vim";
import { highlightExtension } from "@strudel/codemirror";
import CodeMirror, {
  ReactCodeMirrorProps,
  ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import React, { useEffect, useState } from "react";
import { yCollab } from "y-codemirror.next";
import { UndoManager } from "yjs";

const defaultLanguage = "javascript";
const langByTarget = langByTargetUntyped as { [lang: string]: string };
const langExtensionsByLanguage: { [lang: string]: any } = {
  javascript: javascript,
  python: python,
  tidal: tidal,
  zwirn: zwirn,
  punctual: punctual,
};
const panicCodes = panicCodesUntyped as { [target: string]: string };

const panicKeymap = (
  doc: Document,
  keys: string[] = ["Cmd-.", "Ctrl-.", "Alt-."],
) => {
  const panicCode = panicCodes[doc.target];

  return panicCode
    ? keymap.of([
        ...keys.map((key) => ({
          key,
          run() {
            doc.evaluate(panicCode, { from: null, to: null });
            return true;
          },
        })),
      ])
    : [];
};

const tidalMuteKeymap = (doc: Document) => {
  if (doc.target !== "tidal") return [];

  const mutedOutputs = new Set<number>();
  const soloedOutputs = new Set<number>();
  const resetOutputs = Array.from({ length: 20 }, (_, i) => i + 1);

  const toggleMute = (output: number) => {
    if (mutedOutputs.has(output)) {
      mutedOutputs.delete(output);
      doc.evaluate(`unmute ${output}`, { from: null, to: null });
      return;
    }

    mutedOutputs.add(output);
    doc.evaluate(`mute ${output}`, { from: null, to: null });
  };

  const keybinds = [];

  const toggleSolo = (output: number) => {
    if (soloedOutputs.has(output)) {
      soloedOutputs.delete(output);
      doc.evaluate(`unsolo ${output}`, { from: null, to: null });
      return;
    }

    soloedOutputs.add(output);
    doc.evaluate(`solo ${output}`, { from: null, to: null });
  };

  for (let i = 1; i <= 9; i += 1) {
    keybinds.push({
      key: `Ctrl-${i}`,
      run() {
        toggleMute(i);
        return true;
      },
    });
    keybinds.push({
      key: `Cmd-${i}`,
      run() {
        toggleMute(i);
        return true;
      },
    });

    const output = i + 10;
    keybinds.push({
      key: `Ctrl-Alt-${i}`,
      run() {
        toggleMute(output);
        return true;
      },
    });
    keybinds.push({
      key: `Cmd-Alt-${i}`,
      run() {
        toggleMute(output);
        return true;
      },
    });

    keybinds.push({
      key: `Ctrl-Shift-${i}`,
      run() {
        toggleSolo(i);
        return true;
      },
    });
    keybinds.push({
      key: `Cmd-Shift-${i}`,
      run() {
        toggleSolo(i);
        return true;
      },
    });

    keybinds.push({
      key: `Ctrl-Alt-Shift-${i}`,
      run() {
        toggleSolo(output);
        return true;
      },
    });
    keybinds.push({
      key: `Cmd-Alt-Shift-${i}`,
      run() {
        toggleSolo(output);
        return true;
      },
    });
  }

  keybinds.push({
    key: "Ctrl-0",
    run() {
      mutedOutputs.clear();
      resetOutputs.forEach((output) => {
        doc.evaluate(`unmute ${output}`, { from: null, to: null });
      });
      return true;
    },
  });
  keybinds.push({
    key: "Cmd-0",
    run() {
      mutedOutputs.clear();
      resetOutputs.forEach((output) => {
        doc.evaluate(`unmute ${output}`, { from: null, to: null });
      });
      return true;
    },
  });
  keybinds.push({
    key: "Ctrl-Shift-0",
    run() {
      soloedOutputs.clear();
      resetOutputs.forEach((output) => {
        doc.evaluate(`unsolo ${output}`, { from: null, to: null });
      });
      return true;
    },
  });
  keybinds.push({
    key: "Cmd-Shift-0",
    run() {
      soloedOutputs.clear();
      resetOutputs.forEach((output) => {
        doc.evaluate(`unsolo ${output}`, { from: null, to: null });
      });
      return true;
    },
  });

  return keymap.of(keybinds);
};

// extra keymaps
const extraKeymap = () => {
  return keymap.of([
    // fixes the Cmd/Alt-/ issue for Spanish keyboards
    { key: "Shift-Cmd-7", run: toggleLineComment },
    { key: "Shift-Alt-7", run: toggleLineComment },
    { key: "Alt-/", run: toggleLineComment },
    { key: "Ctrl-/", run: toggleLineComment },
  ]);
};

// overwrites the default insertNewlineAndIndent command on Enter
const autoIndentKeymap = (doc: Document) => {
  // if any of the targets is part of the noAutoIndent setting in settings.json
  const noIndent = noAutoIndent.includes(doc.target);
  // overwrite the Enter with insertNewline
  return noIndent
    ? Prec.high(keymap.of([{ key: "Enter", run: insertNewline }]))
    : [];
};

interface FlokSetupOptions {
  readOnly?: boolean;
}

const flokSetup = (
  doc: Document,
  { readOnly = false }: FlokSetupOptions = {},
) => {
  const text = doc.getText();
  const undoManager = new UndoManager(text);
  const defaultMode = targetsWithDocumentEvalMode.includes(doc.target)
    ? "document"
    : "block";
  const web = webTargets.includes(doc.target);

  return [
    flashField(),
    remoteEvalFlash(doc),
    Prec.high(
      evalKeymap(doc, {
        defaultMode,
        web,
        lineEvalKeys: noLineEval.includes(doc.target) ? [] : ["Shift-Enter"],
      }),
    ),
    Prec.high(tidalMuteKeymap(doc)),
    panicKeymap(doc),
    extraKeymap(),
    autoIndentKeymap(doc),
    yCollab(text, doc.session.awareness, {
      undoManager,
      hideCaret: readOnly,
      showLocalCaret: true,
    }),
  ];
};

export interface EditorSettings {
  theme: string;
  fontFamily: string;
  lineNumbers: boolean;
  wrapText: boolean;
  vimMode: boolean;
}

export interface EditorProps extends ReactCodeMirrorProps {
  document?: Document;
  extensionSettings?: any;
  settings?: EditorSettings;
  ref: React.RefObject<ReactCodeMirrorRef>;
}

export const Editor = ({ document, settings, ref, ...props }: EditorProps) => {
  const [mounted, setMounted] = useState(false);
  const [fontLoaded, setFontLoaded] = useState(false);
  const query = useQuery();

  const { theme, fontFamily, lineNumbers, wrapText, vimMode } = {
    theme: "dracula",
    fontFamily: "IBM Plex Mono",
    lineNumbers: false,
    wrapText: false,
    vimMode: false,
    ...settings,
  };

  // Load the current font
  useEffect(() => {
    if (!fontFamily) return;

    let isCancelled = false;

    const loadCurrentFont = async () => {
      await loadFont(fontFamily);
      if (!isCancelled) {
        setFontLoaded(true);
      }
    };

    loadCurrentFont();

    return () => {
      isCancelled = true;
    };
  }, [fontFamily]);

  // useEffect only runs on the client, so now we can safely show the UI
  useEffect(() => {
    // Make sure query parameters are set before loading the editor
    if (!query) return;
    setMounted(true);
  }, [query]);

  if (!mounted || !document || !fontLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-gray-500">Loading editor...</div>
      </div>
    );
  }

  const readOnly = !!query.get("readOnly");
  const language: string = langByTarget[document.target] || defaultLanguage;
  const languageExtension = langExtensionsByLanguage[language] || null;
  const extensions = [
    EditorView.theme({
      "&": {
        fontFamily: fontFamily,
      },
      ".cm-content": {
        fontFamily: fontFamily,
      },
      ".cm-gutters": {
        fontFamily: fontFamily,
        "margin-right": "10px",
      },
      ".cm-line": {
        "font-size": "105%",
        "font-weight": "600",
        background: "rgba(0, 0, 0, 0.7)",
        "max-width": "fit-content",
        padding: "0px",
      },
      ".cm-activeLine": {
        "background-color": "rgba(0, 0, 0, 1) !important",
      },
      "& .cm-scroller": {
        minHeight: "100vh",
      },
      ".cm-ySelectionInfo": {
        opacity: "1",
        fontFamily: fontFamily,
        color: "black",
        padding: "3px 4px",
        fontSize: "0.8rem",
        "font-weight": "bold",
        top: "1.25em",
        "z-index": "1000",
      },
    }),
    flokSetup(document, { readOnly }),
    languageExtension ? languageExtension() : [],
    highlightExtension,
    readOnly ? EditorState.readOnly.of(true) : [],
    lineNumbers ? lineNumbersExtension() : [],
    vimMode ? vim() : [],
    wrapText ? EditorView.lineWrapping : [],
  ];

  // If it's read-only, put a div in front of the editor so that the user
  // can't interact with it.
  return (
    <>
      {readOnly && <div className="absolute inset-0 z-10" />}
      <CodeMirror
        ref={ref}
        value={document.content}
        theme={themes[theme]?.ext || themes["dracula"]?.ext}
        extensions={extensions}
        basicSetup={{
          foldGutter: false,
          lineNumbers: false,
        }}
        {...props}
      />
    </>
  );
};
