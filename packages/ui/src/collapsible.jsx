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
exports.CollapsibleContent = exports.CollapsibleTrigger = exports.Collapsible = void 0;
var radix_ui_1 = require("radix-ui");
var Collapsible = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.Collapsible.Root data-slot="collapsible" {...props}/>;
};
exports.Collapsible = Collapsible;
var CollapsibleTrigger = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.Collapsible.CollapsibleTrigger data-slot="collapsible-trigger" {...props}/>;
};
exports.CollapsibleTrigger = CollapsibleTrigger;
var CollapsibleContent = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.Collapsible.CollapsibleContent data-slot="collapsible-content" {...props}/>;
};
exports.CollapsibleContent = CollapsibleContent;
