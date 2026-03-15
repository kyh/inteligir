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
exports.AIReasoningContent = exports.AIReasoningTrigger = exports.AIReasoning = exports.AIResponse = exports.AIInputModelSelectValue = exports.AIInputModelSelectItem = exports.AIInputModelSelectContent = exports.AIInputModelSelectTrigger = exports.AIInputModelSelect = exports.AIInputSubmit = exports.AIInputButton = exports.AIInputTools = exports.AIInputToolbar = exports.AIInputTextarea = exports.AIInput = exports.AIMessageAvatar = exports.AIMessageContent = exports.AIMessage = exports.AIConversationScrollButton = exports.AIConversationContent = exports.AIConversation = void 0;
var react_1 = require("react");
var react_use_controllable_state_1 = require("@radix-ui/react-use-controllable-state");
var avatar_1 = require("@repo/ui/avatar");
var button_1 = require("@repo/ui/button");
var select_1 = require("@repo/ui/select");
var textarea_1 = require("@repo/ui/textarea");
var utils_1 = require("@repo/ui/utils");
var lucide_react_1 = require("lucide-react");
var react_markdown_1 = require("react-markdown");
var remark_gfm_1 = require("remark-gfm");
var use_stick_to_bottom_1 = require("use-stick-to-bottom");
var code_block_1 = require("./code-block");
var collapsible_1 = require("./collapsible");
var AIConversation = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<use_stick_to_bottom_1.StickToBottom className={(0, utils_1.cn)("relative flex-1 overflow-y-auto", className)} initial="smooth" resize="smooth" role="log" {...props}/>);
};
exports.AIConversation = AIConversation;
var AIConversationContent = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<use_stick_to_bottom_1.StickToBottom.Content className={(0, utils_1.cn)("p-4", className)} {...props}/>);
};
exports.AIConversationContent = AIConversationContent;
var AIConversationScrollButton = function () {
    var _a = (0, use_stick_to_bottom_1.useStickToBottomContext)(), isAtBottom = _a.isAtBottom, scrollToBottom = _a.scrollToBottom;
    var handleScrollToBottom = (0, react_1.useCallback)(function () {
        scrollToBottom();
    }, [scrollToBottom]);
    return (!isAtBottom && (<button_1.Button className="absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full" onClick={handleScrollToBottom} size="icon" type="button" variant="outline">
        <lucide_react_1.ArrowDownIcon className="size-4"/>
      </button_1.Button>));
};
exports.AIConversationScrollButton = AIConversationScrollButton;
var AIMessage = function (_a) {
    var className = _a.className, from = _a.from, props = __rest(_a, ["className", "from"]);
    return (<div className={(0, utils_1.cn)("group flex w-full items-end justify-end gap-2 py-4", from === "user" ? "is-user" : "is-assistant flex-row-reverse justify-end", "[&>div]:max-w-[80%]", className)} {...props}/>);
};
exports.AIMessage = AIMessage;
var AIMessageContent = function (_a) {
    var children = _a.children, className = _a.className, props = __rest(_a, ["children", "className"]);
    return (<div className={(0, utils_1.cn)("flex flex-col gap-2 rounded-lg px-4 py-3 text-sm", "bg-muted text-foreground", "group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground", className)} {...props}>
    <div className="is-user:dark">{children}</div>
  </div>);
};
exports.AIMessageContent = AIMessageContent;
var AIMessageAvatar = function (_a) {
    var src = _a.src, name = _a.name, className = _a.className, props = __rest(_a, ["src", "name", "className"]);
    return (<avatar_1.Avatar className={(0, utils_1.cn)("size-8", className)} {...props}>
    <avatar_1.AvatarImage alt="" className="mt-0 mb-0" src={src}/>
    <avatar_1.AvatarFallback>{(name === null || name === void 0 ? void 0 : name.slice(0, 2)) || "ME"}</avatar_1.AvatarFallback>
  </avatar_1.Avatar>);
};
exports.AIMessageAvatar = AIMessageAvatar;
var useAutoResizeTextarea = function (_a) {
    var minHeight = _a.minHeight, maxHeight = _a.maxHeight;
    var textareaRef = (0, react_1.useRef)(null);
    var adjustHeight = (0, react_1.useCallback)(function (reset) {
        var textarea = textareaRef.current;
        if (!textarea) {
            return;
        }
        if (reset) {
            textarea.style.height = "".concat(minHeight, "px");
            return;
        }
        // Temporarily shrink to get the right scrollHeight
        textarea.style.height = "".concat(minHeight, "px");
        // Calculate new height
        var newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight !== null && maxHeight !== void 0 ? maxHeight : Number.POSITIVE_INFINITY));
        textarea.style.height = "".concat(newHeight, "px");
    }, [minHeight, maxHeight]);
    (0, react_1.useEffect)(function () {
        // Set initial height
        var textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = "".concat(minHeight, "px");
        }
    }, [minHeight]);
    // Adjust height on window resize
    (0, react_1.useEffect)(function () {
        var handleResize = function () { return adjustHeight(); };
        window.addEventListener("resize", handleResize);
        return function () { return window.removeEventListener("resize", handleResize); };
    }, [adjustHeight]);
    return { textareaRef: textareaRef, adjustHeight: adjustHeight };
};
var AIInput = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<form className={(0, utils_1.cn)("bg-background w-full divide-y overflow-hidden rounded-xl border shadow-sm", className)} {...props}/>);
};
exports.AIInput = AIInput;
var AIInputTextarea = function (_a) {
    var onChange = _a.onChange, className = _a.className, _b = _a.placeholder, placeholder = _b === void 0 ? "What would you like to know?" : _b, _c = _a.minHeight, minHeight = _c === void 0 ? 48 : _c, _d = _a.maxHeight, maxHeight = _d === void 0 ? 164 : _d, props = __rest(_a, ["onChange", "className", "placeholder", "minHeight", "maxHeight"]);
    var _e = useAutoResizeTextarea({
        minHeight: minHeight,
        maxHeight: maxHeight,
    }), textareaRef = _e.textareaRef, adjustHeight = _e.adjustHeight;
    var handleKeyDown = function (e) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            var form = e.currentTarget.form;
            if (form) {
                form.requestSubmit();
            }
        }
    };
    return (<textarea_1.Textarea className={(0, utils_1.cn)("w-full resize-none rounded-none border-none p-3 shadow-none ring-0 outline-none", "bg-transparent dark:bg-transparent", "focus-visible:ring-0", className)} name="message" onChange={function (e) {
            adjustHeight();
            onChange === null || onChange === void 0 ? void 0 : onChange(e);
        }} onKeyDown={handleKeyDown} placeholder={placeholder} ref={textareaRef} {...props}/>);
};
exports.AIInputTextarea = AIInputTextarea;
var AIInputToolbar = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div className={(0, utils_1.cn)("flex items-center justify-between p-1", className)} {...props}/>);
};
exports.AIInputToolbar = AIInputToolbar;
var AIInputTools = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div className={(0, utils_1.cn)("flex items-center gap-1", "[&_button:first-child]:rounded-bl-xl", className)} {...props}/>);
};
exports.AIInputTools = AIInputTools;
var AIInputButton = function (_a) {
    var _b = _a.variant, variant = _b === void 0 ? "ghost" : _b, className = _a.className, size = _a.size, props = __rest(_a, ["variant", "className", "size"]);
    var newSize = (size !== null && size !== void 0 ? size : react_1.Children.count(props.children) > 1) ? "default" : "icon";
    return (<button_1.Button className={(0, utils_1.cn)("shrink-0 gap-1.5 rounded-lg", variant === "ghost" && "text-muted-foreground", newSize === "default" && "px-3", className)} size={newSize} type="button" variant={variant} {...props}/>);
};
exports.AIInputButton = AIInputButton;
var AIInputSubmit = function (_a) {
    var className = _a.className, _b = _a.variant, variant = _b === void 0 ? "secondary" : _b, _c = _a.size, size = _c === void 0 ? "icon" : _c, status = _a.status, children = _a.children, props = __rest(_a, ["className", "variant", "size", "status", "children"]);
    var Icon = <lucide_react_1.SendIcon className="size-4"/>;
    if (status === "submitted") {
        Icon = <lucide_react_1.Loader2Icon className="size-4 animate-spin"/>;
    }
    else if (status === "streaming") {
        Icon = <lucide_react_1.SquareIcon className="size-4"/>;
    }
    else if (status === "error") {
        Icon = <lucide_react_1.XIcon className="size-4"/>;
    }
    return (<button_1.Button className={(0, utils_1.cn)("gap-1.5 rounded-lg rounded-br-xl", className)} size={size} type="submit" variant={variant} {...props}>
      {children !== null && children !== void 0 ? children : Icon}
    </button_1.Button>);
};
exports.AIInputSubmit = AIInputSubmit;
var AIInputModelSelect = function (props) { return <select_1.Select {...props}/>; };
exports.AIInputModelSelect = AIInputModelSelect;
var AIInputModelSelectTrigger = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<select_1.SelectTrigger className={(0, utils_1.cn)("text-muted-foreground border-none bg-transparent font-medium shadow-none transition-colors", 'hover:bg-accent hover:text-foreground [&[aria-expanded="true"]]:bg-accent [&[aria-expanded="true"]]:text-foreground', className)} {...props}/>);
};
exports.AIInputModelSelectTrigger = AIInputModelSelectTrigger;
var AIInputModelSelectContent = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return <select_1.SelectContent className={(0, utils_1.cn)(className)} {...props}/>;
};
exports.AIInputModelSelectContent = AIInputModelSelectContent;
var AIInputModelSelectItem = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<select_1.SelectItem className={(0, utils_1.cn)(className)} {...props}/>);
};
exports.AIInputModelSelectItem = AIInputModelSelectItem;
var AIInputModelSelectValue = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<select_1.SelectValue className={(0, utils_1.cn)(className)} {...props}/>);
};
exports.AIInputModelSelectValue = AIInputModelSelectValue;
var components = {
    ol: function (_a) {
        var node = _a.node, children = _a.children, className = _a.className, props = __rest(_a, ["node", "children", "className"]);
        return (<ol className={(0, utils_1.cn)("ml-4 list-outside list-decimal", className)} {...props}>
      {children}
    </ol>);
    },
    li: function (_a) {
        var node = _a.node, children = _a.children, className = _a.className, props = __rest(_a, ["node", "children", "className"]);
        return (<li className={(0, utils_1.cn)("py-1", className)} {...props}>
      {children}
    </li>);
    },
    ul: function (_a) {
        var node = _a.node, children = _a.children, className = _a.className, props = __rest(_a, ["node", "children", "className"]);
        return (<ul className={(0, utils_1.cn)("ml-4 list-outside list-decimal", className)} {...props}>
      {children}
    </ul>);
    },
    strong: function (_a) {
        var node = _a.node, children = _a.children, className = _a.className, props = __rest(_a, ["node", "children", "className"]);
        return (<span className={(0, utils_1.cn)("font-semibold", className)} {...props}>
      {children}
    </span>);
    },
    a: function (_a) {
        var node = _a.node, children = _a.children, className = _a.className, props = __rest(_a, ["node", "children", "className"]);
        return (<a className={(0, utils_1.cn)("text-primary font-medium underline", className)} rel="noreferrer" target="_blank" {...props}>
      {children}
    </a>);
    },
    h1: function (_a) {
        var node = _a.node, children = _a.children, className = _a.className, props = __rest(_a, ["node", "children", "className"]);
        return (<h1 className={(0, utils_1.cn)("mt-6 mb-2 text-3xl font-semibold", className)} {...props}>
      {children}
    </h1>);
    },
    h2: function (_a) {
        var node = _a.node, children = _a.children, className = _a.className, props = __rest(_a, ["node", "children", "className"]);
        return (<h2 className={(0, utils_1.cn)("mt-6 mb-2 text-2xl font-semibold", className)} {...props}>
      {children}
    </h2>);
    },
    h3: function (_a) {
        var node = _a.node, children = _a.children, className = _a.className, props = __rest(_a, ["node", "children", "className"]);
        return (<h3 className={(0, utils_1.cn)("mt-6 mb-2 text-xl font-semibold", className)} {...props}>
      {children}
    </h3>);
    },
    h4: function (_a) {
        var node = _a.node, children = _a.children, className = _a.className, props = __rest(_a, ["node", "children", "className"]);
        return (<h4 className={(0, utils_1.cn)("mt-6 mb-2 text-lg font-semibold", className)} {...props}>
      {children}
    </h4>);
    },
    h5: function (_a) {
        var node = _a.node, children = _a.children, className = _a.className, props = __rest(_a, ["node", "children", "className"]);
        return (<h5 className={(0, utils_1.cn)("mt-6 mb-2 text-base font-semibold", className)} {...props}>
      {children}
    </h5>);
    },
    h6: function (_a) {
        var node = _a.node, children = _a.children, className = _a.className, props = __rest(_a, ["node", "children", "className"]);
        return (<h6 className={(0, utils_1.cn)("mt-6 mb-2 text-sm font-semibold", className)} {...props}>
      {children}
    </h6>);
    },
    pre: function (_a) {
        var _b, _c;
        var node = _a.node, className = _a.className, children = _a.children;
        var language = "javascript";
        if (typeof ((_b = node === null || node === void 0 ? void 0 : node.properties) === null || _b === void 0 ? void 0 : _b.className) === "string") {
            language = node.properties.className.replace("language-", "");
        }
        var childrenIsCode = typeof children === "object" &&
            children !== null &&
            "type" in children &&
            children.type === "code";
        if (!childrenIsCode) {
            return <pre>{children}</pre>;
        }
        var data = [
            {
                language: language,
                filename: "index.js",
                code: children.props.children,
            },
        ];
        return (<code_block_1.CodeBlock className={(0, utils_1.cn)("my-4 h-auto", className)} data={data} defaultValue={(_c = data[0]) === null || _c === void 0 ? void 0 : _c.language}>
        <code_block_1.CodeBlockHeader>
          <code_block_1.CodeBlockFiles>
            {function (item) { return (<code_block_1.CodeBlockFilename key={item.language} value={item.language}>
                {item.filename}
              </code_block_1.CodeBlockFilename>); }}
          </code_block_1.CodeBlockFiles>
          <code_block_1.CodeBlockSelect>
            <code_block_1.CodeBlockSelectTrigger>
              <code_block_1.CodeBlockSelectValue />
            </code_block_1.CodeBlockSelectTrigger>
            <code_block_1.CodeBlockSelectContent>
              {function (item) { return (<code_block_1.CodeBlockSelectItem key={item.language} value={item.language}>
                  {item.language}
                </code_block_1.CodeBlockSelectItem>); }}
            </code_block_1.CodeBlockSelectContent>
          </code_block_1.CodeBlockSelect>
          <code_block_1.CodeBlockCopyButton onCopy={function () { return console.log("Copied code to clipboard"); }} onError={function () { return console.error("Failed to copy code to clipboard"); }}/>
        </code_block_1.CodeBlockHeader>
        <code_block_1.CodeBlockBody>
          {function (item) { return (<code_block_1.CodeBlockItem key={item.language} value={item.language}>
              <code_block_1.CodeBlockContent language={item.language}>
                {item.code}
              </code_block_1.CodeBlockContent>
            </code_block_1.CodeBlockItem>); }}
        </code_block_1.CodeBlockBody>
      </code_block_1.CodeBlock>);
    },
};
exports.AIResponse = (0, react_1.memo)(function (_a) {
    var className = _a.className, options = _a.options, children = _a.children, props = __rest(_a, ["className", "options", "children"]);
    return (<div className={(0, utils_1.cn)("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)} {...props}>
      <react_markdown_1.default components={components} remarkPlugins={[remark_gfm_1.default]} {...options}>
        {children}
      </react_markdown_1.default>
    </div>);
}, function (prevProps, nextProps) { return prevProps.children === nextProps.children; });
var AIReasoningContext = (0, react_1.createContext)(null);
var useAIReasoning = function () {
    var context = (0, react_1.useContext)(AIReasoningContext);
    if (!context) {
        throw new Error("AIReasoning components must be used within AIReasoning");
    }
    return context;
};
exports.AIReasoning = (0, react_1.memo)(function (_a) {
    var className = _a.className, _b = _a.isStreaming, isStreaming = _b === void 0 ? false : _b, open = _a.open, _c = _a.defaultOpen, defaultOpen = _c === void 0 ? false : _c, onOpenChange = _a.onOpenChange, durationProp = _a.duration, children = _a.children, props = __rest(_a, ["className", "isStreaming", "open", "defaultOpen", "onOpenChange", "duration", "children"]);
    var _d = (0, react_use_controllable_state_1.useControllableState)({
        prop: open,
        defaultProp: defaultOpen,
        onChange: onOpenChange,
    }), isOpen = _d[0], setIsOpen = _d[1];
    var _e = (0, react_use_controllable_state_1.useControllableState)({
        prop: durationProp,
        defaultProp: 0,
    }), duration = _e[0], setDuration = _e[1];
    var _f = (0, react_1.useState)(false), hasAutoClosedRef = _f[0], setHasAutoClosedRef = _f[1];
    var _g = (0, react_1.useState)(null), startTime = _g[0], setStartTime = _g[1];
    // Track duration when streaming starts and ends
    (0, react_1.useEffect)(function () {
        if (isStreaming) {
            if (startTime === null) {
                setStartTime(Date.now());
            }
        }
        else if (startTime !== null) {
            setDuration(Math.round((Date.now() - startTime) / 1000));
            setStartTime(null);
        }
    }, [isStreaming, startTime, setDuration]);
    // Auto-open when streaming starts, auto-close when streaming ends (once only)
    (0, react_1.useEffect)(function () {
        if (isStreaming && !isOpen) {
            setIsOpen(true);
        }
        else if (!isStreaming && isOpen && !defaultOpen && !hasAutoClosedRef) {
            // Add a small delay before closing to allow user to see the content
            var timer_1 = setTimeout(function () {
                setIsOpen(false);
                setHasAutoClosedRef(true);
            }, 1000);
            return function () { return clearTimeout(timer_1); };
        }
    }, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosedRef]);
    var handleOpenChange = function (open) {
        setIsOpen(open);
    };
    return (<AIReasoningContext.Provider value={{ isStreaming: isStreaming, isOpen: isOpen, setIsOpen: setIsOpen, duration: duration }}>
        <collapsible_1.Collapsible className={(0, utils_1.cn)("not-prose mb-4", className)} onOpenChange={handleOpenChange} open={isOpen} {...props}>
          {children}
        </collapsible_1.Collapsible>
      </AIReasoningContext.Provider>);
});
exports.AIReasoningTrigger = (0, react_1.memo)(function (_a) {
    var className = _a.className, _b = _a.title, title = _b === void 0 ? "Reasoning" : _b, children = _a.children, props = __rest(_a, ["className", "title", "children"]);
    var _c = useAIReasoning(), isStreaming = _c.isStreaming, isOpen = _c.isOpen, duration = _c.duration;
    return (<collapsible_1.CollapsibleTrigger className={(0, utils_1.cn)("text-muted-foreground flex items-center gap-2 text-sm", className)} {...props}>
        {children !== null && children !== void 0 ? children : (<>
            {isStreaming && duration === 0 ? (<p>Thinking...</p>) : (<p>Thought for {duration} seconds</p>)}
            <lucide_react_1.ChevronDownIcon className={(0, utils_1.cn)("text-muted-foreground size-4 transition-transform", isOpen ? "rotate-180" : "rotate-0")}/>
          </>)}
      </collapsible_1.CollapsibleTrigger>);
});
exports.AIReasoningContent = (0, react_1.memo)(function (_a) {
    var className = _a.className, children = _a.children, props = __rest(_a, ["className", "children"]);
    return (<collapsible_1.CollapsibleContent className={(0, utils_1.cn)("text-muted-foreground mt-4 text-sm", className)} {...props}>
      <exports.AIResponse className="grid gap-2">{children}</exports.AIResponse>
    </collapsible_1.CollapsibleContent>);
});
exports.AIReasoning.displayName = "AIReasoning";
exports.AIReasoningTrigger.displayName = "AIReasoningTrigger";
exports.AIReasoningContent.displayName = "AIReasoningContent";
