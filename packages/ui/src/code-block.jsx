"use client";
"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeBlockContent = exports.CodeBlockItem = exports.CodeBlockBody = exports.CodeBlockCopyButton = exports.CodeBlockSelectItem = exports.CodeBlockSelectContent = exports.CodeBlockSelectValue = exports.CodeBlockSelectTrigger = exports.CodeBlockSelect = exports.CodeBlockFilename = exports.CodeBlockFiles = exports.CodeBlockHeader = exports.CodeBlock = void 0;
var react_1 = require("react");
var react_simple_icons_1 = require("@icons-pack/react-simple-icons");
var react_use_controllable_state_1 = require("@radix-ui/react-use-controllable-state");
var transformers_1 = require("@shikijs/transformers");
var lucide_react_1 = require("lucide-react");
var shiki_1 = require("shiki");
var button_1 = require("./button");
var select_1 = require("./select");
var utils_1 = require("./utils");
var filenameIconMap = {
    ".env": react_simple_icons_1.SiDotenv,
    "*.astro": react_simple_icons_1.SiAstro,
    "biome.json": react_simple_icons_1.SiBiome,
    ".bowerrc": react_simple_icons_1.SiBower,
    "bun.lockb": react_simple_icons_1.SiBun,
    "*.c": react_simple_icons_1.SiC,
    "*.cpp": react_simple_icons_1.SiCplusplus,
    ".circleci/config.yml": react_simple_icons_1.SiCircleci,
    "*.coffee": react_simple_icons_1.SiCoffeescript,
    "*.module.css": react_simple_icons_1.SiCssmodules,
    "*.css": react_simple_icons_1.SiCss,
    "*.dart": react_simple_icons_1.SiDart,
    Dockerfile: react_simple_icons_1.SiDocker,
    "docusaurus.config.js": react_simple_icons_1.SiDocusaurus,
    ".editorconfig": react_simple_icons_1.SiEditorconfig,
    ".eslintrc": react_simple_icons_1.SiEslint,
    "eslint.config.*": react_simple_icons_1.SiEslint,
    "gatsby-config.*": react_simple_icons_1.SiGatsby,
    ".gitignore": react_simple_icons_1.SiGitignoredotio,
    "*.go": react_simple_icons_1.SiGo,
    "*.graphql": react_simple_icons_1.SiGraphql,
    "*.sh": react_simple_icons_1.SiGnubash,
    "Gruntfile.*": react_simple_icons_1.SiGrunt,
    "gulpfile.*": react_simple_icons_1.SiGulp,
    "*.hbs": react_simple_icons_1.SiHandlebarsdotjs,
    "*.html": react_simple_icons_1.SiHtml5,
    "*.js": react_simple_icons_1.SiJavascript,
    "*.json": react_simple_icons_1.SiJson,
    "*.test.js": react_simple_icons_1.SiJest,
    "*.less": react_simple_icons_1.SiLess,
    "*.md": react_simple_icons_1.SiMarkdown,
    "*.mdx": react_simple_icons_1.SiMdx,
    "mintlify.json": react_simple_icons_1.SiMintlify,
    "mocha.opts": react_simple_icons_1.SiMocha,
    "*.mustache": react_simple_icons_1.SiHandlebarsdotjs,
    "*.sql": react_simple_icons_1.SiMysql,
    "next.config.*": react_simple_icons_1.SiNextdotjs,
    "*.pl": react_simple_icons_1.SiPerl,
    "*.php": react_simple_icons_1.SiPhp,
    "postcss.config.*": react_simple_icons_1.SiPostcss,
    "prettier.config.*": react_simple_icons_1.SiPrettier,
    "*.prisma": react_simple_icons_1.SiPrisma,
    "*.pug": react_simple_icons_1.SiPug,
    "*.py": react_simple_icons_1.SiPython,
    "*.r": react_simple_icons_1.SiR,
    "*.rb": react_simple_icons_1.SiRuby,
    "*.jsx": react_simple_icons_1.SiReact,
    "*.tsx": react_simple_icons_1.SiReact,
    "readme.md": react_simple_icons_1.SiReadme,
    "*.rdb": react_simple_icons_1.SiRedis,
    "remix.config.*": react_simple_icons_1.SiRemix,
    "*.riv": react_simple_icons_1.SiRive,
    "rollup.config.*": react_simple_icons_1.SiRollupdotjs,
    "sanity.config.*": react_simple_icons_1.SiSanity,
    "*.sass": react_simple_icons_1.SiSass,
    "*.scss": react_simple_icons_1.SiSass,
    "*.sc": react_simple_icons_1.SiScala,
    "*.scala": react_simple_icons_1.SiScala,
    "sentry.client.config.*": react_simple_icons_1.SiSentry,
    "components.json": react_simple_icons_1.SiShadcnui,
    "storybook.config.*": react_simple_icons_1.SiStorybook,
    "stylelint.config.*": react_simple_icons_1.SiStylelint,
    ".sublime-settings": react_simple_icons_1.SiSublimetext,
    "*.svelte": react_simple_icons_1.SiSvelte,
    "*.svg": react_simple_icons_1.SiSvg,
    "*.swift": react_simple_icons_1.SiSwift,
    "tailwind.config.*": react_simple_icons_1.SiTailwindcss,
    "*.toml": react_simple_icons_1.SiToml,
    "*.ts": react_simple_icons_1.SiTypescript,
    "vercel.json": react_simple_icons_1.SiVercel,
    "vite.config.*": react_simple_icons_1.SiVite,
    "*.vue": react_simple_icons_1.SiVuedotjs,
    "*.wasm": react_simple_icons_1.SiWebassembly,
};
var lineNumberClassNames = (0, utils_1.cn)("[&_code]:[counter-reset:line]", "[&_code]:[counter-increment:line_0]", "[&_.line]:before:content-[counter(line)]", "[&_.line]:before:inline-block", "[&_.line]:before:[counter-increment:line]", "[&_.line]:before:w-4", "[&_.line]:before:mr-4", "[&_.line]:before:text-[13px]", "[&_.line]:before:text-right", "[&_.line]:before:text-muted-foreground/50", "[&_.line]:before:font-mono", "[&_.line]:before:select-none");
var darkModeClassNames = (0, utils_1.cn)("dark:[&_.shiki]:!text-[var(--shiki-dark)]", "dark:[&_.shiki]:!bg-[var(--shiki-dark-bg)]", "dark:[&_.shiki]:![font-style:var(--shiki-dark-font-style)]", "dark:[&_.shiki]:![font-weight:var(--shiki-dark-font-weight)]", "dark:[&_.shiki]:![text-decoration:var(--shiki-dark-text-decoration)]", "dark:[&_.shiki_span]:!text-[var(--shiki-dark)]", "dark:[&_.shiki_span]:![font-style:var(--shiki-dark-font-style)]", "dark:[&_.shiki_span]:![font-weight:var(--shiki-dark-font-weight)]", "dark:[&_.shiki_span]:![text-decoration:var(--shiki-dark-text-decoration)]");
var lineHighlightClassNames = (0, utils_1.cn)("[&_.line.highlighted]:bg-blue-50", "[&_.line.highlighted]:after:bg-blue-500", "[&_.line.highlighted]:after:absolute", "[&_.line.highlighted]:after:left-0", "[&_.line.highlighted]:after:top-0", "[&_.line.highlighted]:after:bottom-0", "[&_.line.highlighted]:after:w-0.5", "dark:[&_.line.highlighted]:!bg-blue-500/10");
var lineDiffClassNames = (0, utils_1.cn)("[&_.line.diff]:after:absolute", "[&_.line.diff]:after:left-0", "[&_.line.diff]:after:top-0", "[&_.line.diff]:after:bottom-0", "[&_.line.diff]:after:w-0.5", "[&_.line.diff.add]:bg-emerald-50", "[&_.line.diff.add]:after:bg-emerald-500", "[&_.line.diff.remove]:bg-rose-50", "[&_.line.diff.remove]:after:bg-rose-500", "dark:[&_.line.diff.add]:!bg-emerald-500/10", "dark:[&_.line.diff.remove]:!bg-rose-500/10");
var lineFocusedClassNames = (0, utils_1.cn)("[&_code:has(.focused)_.line]:blur-[2px]", "[&_code:has(.focused)_.line.focused]:blur-none");
var wordHighlightClassNames = (0, utils_1.cn)("[&_.highlighted-word]:bg-blue-50", "dark:[&_.highlighted-word]:!bg-blue-500/10");
var codeBlockClassName = (0, utils_1.cn)("bg-background mt-0 text-sm", "[&_pre]:py-4", "[&_.shiki]:!bg-[var(--shiki-bg)]", "[&_code]:w-full", "[&_code]:grid", "[&_code]:overflow-x-auto", "[&_code]:bg-transparent", "[&_.line]:px-4", "[&_.line]:w-full", "[&_.line]:relative");
var highlight = function (html, language, themes) {
    return (0, shiki_1.codeToHtml)(html, {
        lang: language !== null && language !== void 0 ? language : "typescript",
        themes: themes !== null && themes !== void 0 ? themes : {
            light: "github-light",
            dark: "github-dark-default",
        },
        transformers: [
            (0, transformers_1.transformerNotationDiff)({
                matchAlgorithm: "v3",
            }),
            (0, transformers_1.transformerNotationHighlight)({
                matchAlgorithm: "v3",
            }),
            (0, transformers_1.transformerNotationWordHighlight)({
                matchAlgorithm: "v3",
            }),
            (0, transformers_1.transformerNotationFocus)({
                matchAlgorithm: "v3",
            }),
            (0, transformers_1.transformerNotationErrorLevel)({
                matchAlgorithm: "v3",
            }),
        ],
    });
};
var CodeBlockContext = (0, react_1.createContext)({
    value: undefined,
    onValueChange: undefined,
    data: [],
});
var CodeBlock = function (_a) {
    var controlledValue = _a.value, controlledOnValueChange = _a.onValueChange, defaultValue = _a.defaultValue, className = _a.className, data = _a.data, props = __rest(_a, ["value", "onValueChange", "defaultValue", "className", "data"]);
    var _b = (0, react_use_controllable_state_1.useControllableState)({
        defaultProp: defaultValue !== null && defaultValue !== void 0 ? defaultValue : "",
        prop: controlledValue,
        onChange: controlledOnValueChange,
    }), value = _b[0], onValueChange = _b[1];
    return (<CodeBlockContext.Provider value={{ value: value, onValueChange: onValueChange, data: data }}>
      <div className={(0, utils_1.cn)("size-full overflow-hidden rounded-md border", className)} {...props}/>
    </CodeBlockContext.Provider>);
};
exports.CodeBlock = CodeBlock;
var CodeBlockHeader = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div className={(0, utils_1.cn)("bg-secondary flex flex-row items-center border-b p-1", className)} {...props}/>);
};
exports.CodeBlockHeader = CodeBlockHeader;
var CodeBlockFiles = function (_a) {
    var className = _a.className, children = _a.children, props = __rest(_a, ["className", "children"]);
    var data = (0, react_1.useContext)(CodeBlockContext).data;
    return (<div className={(0, utils_1.cn)("flex grow flex-row items-center gap-2", className)} {...props}>
      {data.map(children)}
    </div>);
};
exports.CodeBlockFiles = CodeBlockFiles;
var CodeBlockFilename = function (_a) {
    var _b;
    var className = _a.className, icon = _a.icon, value = _a.value, children = _a.children, props = __rest(_a, ["className", "icon", "value", "children"]);
    var activeValue = (0, react_1.useContext)(CodeBlockContext).value;
    var defaultIcon = (_b = Object.entries(filenameIconMap).find(function (_a) {
        var pattern = _a[0];
        var regex = new RegExp("^".concat(pattern.replace(/\\/g, "\\\\").replace(/\./g, "\\.").replace(/\*/g, ".*"), "$"));
        return regex.test(children);
    })) === null || _b === void 0 ? void 0 : _b[1];
    var Icon = icon !== null && icon !== void 0 ? icon : defaultIcon;
    if (value !== activeValue) {
        return null;
    }
    return (<div className="bg-secondary text-muted-foreground flex items-center gap-2 px-4 py-1.5 text-xs" {...props}>
      {Icon && <Icon className="h-4 w-4 shrink-0"/>}
      <span className="flex-1 truncate">{children}</span>
    </div>);
};
exports.CodeBlockFilename = CodeBlockFilename;
var CodeBlockSelect = function (props) {
    var _a = (0, react_1.useContext)(CodeBlockContext), value = _a.value, onValueChange = _a.onValueChange;
    return <select_1.Select onValueChange={onValueChange} value={value} {...props}/>;
};
exports.CodeBlockSelect = CodeBlockSelect;
var CodeBlockSelectTrigger = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<select_1.SelectTrigger className={(0, utils_1.cn)("text-muted-foreground w-fit border-none text-xs shadow-none", className)} {...props}/>);
};
exports.CodeBlockSelectTrigger = CodeBlockSelectTrigger;
var CodeBlockSelectValue = function (props) { return (<select_1.SelectValue {...props}/>); };
exports.CodeBlockSelectValue = CodeBlockSelectValue;
var CodeBlockSelectContent = function (_a) {
    var children = _a.children, props = __rest(_a, ["children"]);
    var data = (0, react_1.useContext)(CodeBlockContext).data;
    return <select_1.SelectContent {...props}>{data.map(children)}</select_1.SelectContent>;
};
exports.CodeBlockSelectContent = CodeBlockSelectContent;
var CodeBlockSelectItem = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<select_1.SelectItem className={(0, utils_1.cn)("text-sm", className)} {...props}/>);
};
exports.CodeBlockSelectItem = CodeBlockSelectItem;
var CodeBlockCopyButton = function (_a) {
    var _b;
    var asChild = _a.asChild, onCopy = _a.onCopy, onError = _a.onError, _c = _a.timeout, timeout = _c === void 0 ? 2000 : _c, children = _a.children, className = _a.className, props = __rest(_a, ["asChild", "onCopy", "onError", "timeout", "children", "className"]);
    var _d = (0, react_1.useState)(false), isCopied = _d[0], setIsCopied = _d[1];
    var _e = (0, react_1.useContext)(CodeBlockContext), data = _e.data, value = _e.value;
    var code = (_b = data.find(function (item) { return item.language === value; })) === null || _b === void 0 ? void 0 : _b.code;
    var copyToClipboard = function () {
        if (typeof window === "undefined" || !navigator.clipboard.writeText || !code) {
            return;
        }
        navigator.clipboard.writeText(code).then(function () {
            setIsCopied(true);
            onCopy === null || onCopy === void 0 ? void 0 : onCopy();
            setTimeout(function () { return setIsCopied(false); }, timeout);
        }, onError);
    };
    if (asChild) {
        return (0, react_1.cloneElement)(children, {
            // @ts-expect-error - we know this is a button
            onClick: copyToClipboard,
        });
    }
    var Icon = isCopied ? lucide_react_1.CheckIcon : lucide_react_1.CopyIcon;
    return (<button_1.Button className={(0, utils_1.cn)("shrink-0", className)} onClick={copyToClipboard} size="icon" variant="ghost" {...props}>
      {children !== null && children !== void 0 ? children : <Icon className="text-muted-foreground" size={14}/>}
    </button_1.Button>);
};
exports.CodeBlockCopyButton = CodeBlockCopyButton;
var CodeBlockFallback = function (_a) {
    var children = _a.children, props = __rest(_a, ["children"]);
    return (<div {...props}>
    <pre className="w-full">
      <code>
        {children === null || children === void 0 ? void 0 : children.toString().split("\n").map(function (line, i) { return (<span className="line" key={i}>
              {line}
            </span>); })}
      </code>
    </pre>
  </div>);
};
var CodeBlockBody = function (_a) {
    var children = _a.children, props = __rest(_a, ["children"]);
    var data = (0, react_1.useContext)(CodeBlockContext).data;
    return <div {...props}>{data.map(children)}</div>;
};
exports.CodeBlockBody = CodeBlockBody;
var CodeBlockItem = function (_a) {
    var children = _a.children, _b = _a.lineNumbers, lineNumbers = _b === void 0 ? true : _b, className = _a.className, value = _a.value, props = __rest(_a, ["children", "lineNumbers", "className", "value"]);
    var activeValue = (0, react_1.useContext)(CodeBlockContext).value;
    if (value !== activeValue) {
        return null;
    }
    return (<div className={(0, utils_1.cn)(codeBlockClassName, lineHighlightClassNames, lineDiffClassNames, lineFocusedClassNames, wordHighlightClassNames, darkModeClassNames, lineNumbers && lineNumberClassNames, className)} {...props}>
      {children}
    </div>);
};
exports.CodeBlockItem = CodeBlockItem;
var CodeBlockContent = function (_a) {
    var children = _a.children, themes = _a.themes, language = _a.language, _b = _a.syntaxHighlighting, syntaxHighlighting = _b === void 0 ? true : _b, props = __rest(_a, ["children", "themes", "language", "syntaxHighlighting"]);
    var _c = (0, react_1.useState)(null), html = _c[0], setHtml = _c[1];
    (0, react_1.useEffect)(function () {
        if (!syntaxHighlighting) {
            return;
        }
        highlight(children, language, themes)
            .then(setHtml)
            // biome-ignore lint/suspicious/noConsole: "it's fine"
            .catch(console.error);
    }, [children, themes, syntaxHighlighting, language]);
    if (!(syntaxHighlighting && html)) {
        return <CodeBlockFallback>{children}</CodeBlockFallback>;
    }
    return (<div 
    // biome-ignore lint/security/noDangerouslySetInnerHtml: "Kinda how Shiki works"
    dangerouslySetInnerHTML={{ __html: html }} {...props}/>);
};
exports.CodeBlockContent = CodeBlockContent;
