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
exports.DialogTrigger = exports.DialogTitle = exports.DialogPortal = exports.DialogOverlay = exports.DialogHeader = exports.DialogFooter = exports.DialogDescription = exports.DialogContent = exports.DialogClose = exports.Dialog = void 0;
var React = require("react");
var lucide_react_1 = require("lucide-react");
var radix_ui_1 = require("radix-ui");
var utils_1 = require("./utils");
var Dialog = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.Dialog.Root data-slot="dialog" {...props}/>;
};
exports.Dialog = Dialog;
var DialogTrigger = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.Dialog.Trigger data-slot="dialog-trigger" {...props}/>;
};
exports.DialogTrigger = DialogTrigger;
var DialogPortal = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.Dialog.Portal data-slot="dialog-portal" {...props}/>;
};
exports.DialogPortal = DialogPortal;
var DialogClose = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.Dialog.Close data-slot="dialog-close" {...props}/>;
};
exports.DialogClose = DialogClose;
var DialogOverlay = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.Dialog.Overlay data-slot="dialog-overlay" className={(0, utils_1.cn)("data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50", className)} {...props}/>);
};
exports.DialogOverlay = DialogOverlay;
var DialogContent = function (_a) {
    var className = _a.className, children = _a.children, _b = _a.showCloseButton, showCloseButton = _b === void 0 ? true : _b, props = __rest(_a, ["className", "children", "showCloseButton"]);
    return (<DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <radix_ui_1.Dialog.Content data-slot="dialog-content" className={(0, utils_1.cn)("bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg", className)} {...props}>
        {children}
        {showCloseButton && (<radix_ui_1.Dialog.Close data-slot="dialog-close" className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
            <lucide_react_1.XIcon />
            <span className="sr-only">Close</span>
          </radix_ui_1.Dialog.Close>)}
      </radix_ui_1.Dialog.Content>
    </DialogPortal>);
};
exports.DialogContent = DialogContent;
var DialogHeader = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div data-slot="dialog-header" className={(0, utils_1.cn)("flex flex-col gap-2 text-center sm:text-left", className)} {...props}/>);
};
exports.DialogHeader = DialogHeader;
var DialogFooter = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div data-slot="dialog-footer" className={(0, utils_1.cn)("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props}/>);
};
exports.DialogFooter = DialogFooter;
var DialogTitle = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.Dialog.Title data-slot="dialog-title" className={(0, utils_1.cn)("text-lg leading-none font-semibold", className)} {...props}/>);
};
exports.DialogTitle = DialogTitle;
var DialogDescription = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.Dialog.Description data-slot="dialog-description" className={(0, utils_1.cn)("text-muted-foreground text-sm", className)} {...props}/>);
};
exports.DialogDescription = DialogDescription;
