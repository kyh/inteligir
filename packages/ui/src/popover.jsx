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
exports.PopoverAnchor = exports.PopoverContent = exports.PopoverTrigger = exports.Popover = void 0;
var React = require("react");
var radix_ui_1 = require("radix-ui");
var utils_1 = require("./utils");
var Popover = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.Popover.Root data-slot="popover" {...props}/>;
};
exports.Popover = Popover;
var PopoverTrigger = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.Popover.Trigger data-slot="popover-trigger" {...props}/>;
};
exports.PopoverTrigger = PopoverTrigger;
var PopoverContent = function (_a) {
    var className = _a.className, _b = _a.align, align = _b === void 0 ? "center" : _b, _c = _a.sideOffset, sideOffset = _c === void 0 ? 4 : _c, props = __rest(_a, ["className", "align", "sideOffset"]);
    return (<radix_ui_1.Popover.Portal>
      <radix_ui_1.Popover.Content data-slot="popover-content" align={align} sideOffset={sideOffset} className={(0, utils_1.cn)("bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden", className)} {...props}/>
    </radix_ui_1.Popover.Portal>);
};
exports.PopoverContent = PopoverContent;
var PopoverAnchor = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.Popover.Anchor data-slot="popover-anchor" {...props}/>;
};
exports.PopoverAnchor = PopoverAnchor;
