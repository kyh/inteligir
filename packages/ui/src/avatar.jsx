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
exports.ProfileAvatar = exports.AvatarFallback = exports.AvatarImage = exports.Avatar = void 0;
var React = require("react");
var radix_ui_1 = require("radix-ui");
var utils_1 = require("./utils");
var Avatar = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.Avatar.Root data-slot="avatar" className={(0, utils_1.cn)("relative flex size-8 shrink-0 overflow-hidden rounded-full", className)} {...props}/>);
};
exports.Avatar = Avatar;
var AvatarImage = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.Avatar.Image data-slot="avatar-image" className={(0, utils_1.cn)("aspect-square size-full", className)} {...props}/>);
};
exports.AvatarImage = AvatarImage;
var AvatarFallback = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.Avatar.Fallback data-slot="avatar-fallback" className={(0, utils_1.cn)("bg-muted flex size-full items-center justify-center rounded-full", className)} {...props}/>);
};
exports.AvatarFallback = AvatarFallback;
var ProfileAvatar = function (_a) {
    var className = _a.className, displayName = _a.displayName, avatarUrl = _a.avatarUrl;
    var initials = displayName === null || displayName === void 0 ? void 0 : displayName.slice(0, 1);
    return (<Avatar className={(0, utils_1.cn)("size-9", className)}>
      <AvatarImage src={avatarUrl !== null && avatarUrl !== void 0 ? avatarUrl : undefined}/>
      <AvatarFallback className="animate-in fade-in uppercase">{initials}</AvatarFallback>
    </Avatar>);
};
exports.ProfileAvatar = ProfileAvatar;
