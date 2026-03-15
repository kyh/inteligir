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
exports.DrawerDescription = exports.DrawerTitle = exports.DrawerFooter = exports.DrawerHeader = exports.DrawerContent = exports.DrawerClose = exports.DrawerTrigger = exports.DrawerOverlay = exports.DrawerPortal = exports.Drawer = void 0;
var React = require("react");
var vaul_1 = require("vaul");
var utils_1 = require("./utils");
var Drawer = function (_a) {
    var props = __rest(_a, []);
    return <vaul_1.Drawer.Root data-slot="drawer" {...props}/>;
};
exports.Drawer = Drawer;
var DrawerTrigger = function (_a) {
    var props = __rest(_a, []);
    return <vaul_1.Drawer.Trigger data-slot="drawer-trigger" {...props}/>;
};
exports.DrawerTrigger = DrawerTrigger;
var DrawerPortal = function (_a) {
    var props = __rest(_a, []);
    return <vaul_1.Drawer.Portal data-slot="drawer-portal" {...props}/>;
};
exports.DrawerPortal = DrawerPortal;
var DrawerClose = function (_a) {
    var props = __rest(_a, []);
    return <vaul_1.Drawer.Close data-slot="drawer-close" {...props}/>;
};
exports.DrawerClose = DrawerClose;
var DrawerOverlay = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<vaul_1.Drawer.Overlay data-slot="drawer-overlay" className={(0, utils_1.cn)("data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50", className)} {...props}/>);
};
exports.DrawerOverlay = DrawerOverlay;
var DrawerContent = function (_a) {
    var className = _a.className, children = _a.children, props = __rest(_a, ["className", "children"]);
    return (<DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      <vaul_1.Drawer.Content data-slot="drawer-content" className={(0, utils_1.cn)("group/drawer-content bg-background fixed z-50 flex h-auto flex-col", "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80vh] data-[vaul-drawer-direction=top]:rounded-b-lg data-[vaul-drawer-direction=top]:border-b", "data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[80vh] data-[vaul-drawer-direction=bottom]:rounded-t-lg data-[vaul-drawer-direction=bottom]:border-t", "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=right]:sm:max-w-sm", "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=left]:sm:max-w-sm", className)} {...props}>
        <div className="bg-muted mx-auto mt-4 hidden h-2 w-[100px] shrink-0 rounded-full group-data-[vaul-drawer-direction=bottom]/drawer-content:block"/>
        {children}
      </vaul_1.Drawer.Content>
    </DrawerPortal>);
};
exports.DrawerContent = DrawerContent;
var DrawerHeader = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div data-slot="drawer-header" className={(0, utils_1.cn)("flex flex-col gap-0.5 p-4 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-1.5 md:text-left", className)} {...props}/>);
};
exports.DrawerHeader = DrawerHeader;
var DrawerFooter = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div data-slot="drawer-footer" className={(0, utils_1.cn)("mt-auto flex flex-col gap-2 p-4", className)} {...props}/>);
};
exports.DrawerFooter = DrawerFooter;
var DrawerTitle = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<vaul_1.Drawer.Title data-slot="drawer-title" className={(0, utils_1.cn)("text-foreground font-semibold", className)} {...props}/>);
};
exports.DrawerTitle = DrawerTitle;
var DrawerDescription = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<vaul_1.Drawer.Description data-slot="drawer-description" className={(0, utils_1.cn)("text-muted-foreground text-sm", className)} {...props}/>);
};
exports.DrawerDescription = DrawerDescription;
