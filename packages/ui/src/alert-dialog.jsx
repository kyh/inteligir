"use client";
"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.GlobalAlertDialog = exports.alertDialog = exports.AlertDialogCancel = exports.AlertDialogAction = exports.AlertDialogDescription = exports.AlertDialogTitle = exports.AlertDialogFooter = exports.AlertDialogHeader = exports.AlertDialogContent = exports.AlertDialogTrigger = exports.AlertDialogOverlay = exports.AlertDialogPortal = exports.AlertDialog = void 0;
var React = require("react");
var radix_ui_1 = require("radix-ui");
var button_1 = require("./button");
var utils_1 = require("./utils");
var AlertDialog = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.AlertDialog.Root data-slot="alert-dialog" {...props}/>;
};
exports.AlertDialog = AlertDialog;
var AlertDialogTrigger = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.AlertDialog.Trigger data-slot="alert-dialog-trigger" {...props}/>;
};
exports.AlertDialogTrigger = AlertDialogTrigger;
var AlertDialogPortal = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.AlertDialog.Portal data-slot="alert-dialog-portal" {...props}/>;
};
exports.AlertDialogPortal = AlertDialogPortal;
var AlertDialogOverlay = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.AlertDialog.Overlay data-slot="alert-dialog-overlay" className={(0, utils_1.cn)("data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50", className)} {...props}/>);
};
exports.AlertDialogOverlay = AlertDialogOverlay;
var AlertDialogContent = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<AlertDialogPortal>
      <AlertDialogOverlay />
      <radix_ui_1.AlertDialog.Content data-slot="alert-dialog-content" className={(0, utils_1.cn)("bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg", className)} {...props}/>
    </AlertDialogPortal>);
};
exports.AlertDialogContent = AlertDialogContent;
var AlertDialogHeader = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div data-slot="alert-dialog-header" className={(0, utils_1.cn)("flex flex-col gap-2 text-center sm:text-left", className)} {...props}/>);
};
exports.AlertDialogHeader = AlertDialogHeader;
var AlertDialogFooter = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div data-slot="alert-dialog-footer" className={(0, utils_1.cn)("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props}/>);
};
exports.AlertDialogFooter = AlertDialogFooter;
var AlertDialogTitle = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.AlertDialog.Title data-slot="alert-dialog-title" className={(0, utils_1.cn)("text-lg font-semibold", className)} {...props}/>);
};
exports.AlertDialogTitle = AlertDialogTitle;
var AlertDialogDescription = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.AlertDialog.Description data-slot="alert-dialog-description" className={(0, utils_1.cn)("text-muted-foreground text-sm", className)} {...props}/>);
};
exports.AlertDialogDescription = AlertDialogDescription;
var AlertDialogAction = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return <radix_ui_1.AlertDialog.Action className={(0, utils_1.cn)((0, button_1.buttonVariants)(), className)} {...props}/>;
};
exports.AlertDialogAction = AlertDialogAction;
var AlertDialogCancel = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.AlertDialog.Cancel className={(0, utils_1.cn)((0, button_1.buttonVariants)({ variant: "outline" }), className)} {...props}/>);
};
exports.AlertDialogCancel = AlertDialogCancel;
var alertDialogStore = {
    state: {
        open: false,
        title: "",
    },
    listeners: [],
    subscribe: function (listener) {
        alertDialogStore.listeners.push(listener);
        return function () {
            alertDialogStore.listeners = alertDialogStore.listeners.filter(function (l) { return l !== listener; });
        };
    },
    getSnapshot: function () {
        return alertDialogStore.state;
    },
    emitChange: function () {
        alertDialogStore.listeners.forEach(function (listener) { return listener(); });
    },
};
exports.alertDialog = {
    open: function (title, options) {
        alertDialogStore.state = __assign(__assign(__assign({}, alertDialogStore.state), options), { open: true, title: title });
        alertDialogStore.emitChange();
    },
    close: function () {
        alertDialogStore.state = __assign(__assign({}, alertDialogStore.state), { open: false });
        alertDialogStore.emitChange();
    },
};
var GlobalAlertDialog = function () {
    var _a, _b, _c, _d, _e, _f;
    var _g = React.useState(false), pendingAction = _g[0], setPendingAction = _g[1];
    var _h = React.useState(false), pendingCancel = _h[0], setPendingCancel = _h[1];
    var alertState = React.useSyncExternalStore(alertDialogStore.subscribe, alertDialogStore.getSnapshot, alertDialogStore.getSnapshot);
    var onOpenChange = function (open) {
        var _a, _b;
        if (pendingAction || pendingCancel)
            return;
        if (!open) {
            setPendingCancel(true);
            var res = (_b = (_a = alertState.cancel) === null || _a === void 0 ? void 0 : _a.onClick) === null || _b === void 0 ? void 0 : _b.call(_a);
            if (res instanceof Promise) {
                void res.then(function () {
                    setPendingCancel(false);
                    exports.alertDialog.close();
                });
            }
            else {
                setPendingCancel(false);
                exports.alertDialog.close();
            }
        }
    };
    var onConfirm = function () {
        var _a, _b;
        setPendingAction(true);
        var res = (_b = (_a = alertState.action) === null || _a === void 0 ? void 0 : _a.onClick) === null || _b === void 0 ? void 0 : _b.call(_a);
        if (res instanceof Promise) {
            void res.then(function () {
                setPendingAction(false);
                exports.alertDialog.close();
            });
        }
        else {
            setPendingAction(false);
            exports.alertDialog.close();
        }
    };
    return (<AlertDialog open={alertState.open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{alertState.title}</AlertDialogTitle>
        </AlertDialogHeader>
        {alertState.description && (<AlertDialogDescription>{alertState.description}</AlertDialogDescription>)}
        <AlertDialogFooter>
          {!((_a = alertState.action) === null || _a === void 0 ? void 0 : _a.hidden) && (<button_1.Button onClick={onConfirm} loading={pendingAction}>
              {(_c = (_b = alertState.action) === null || _b === void 0 ? void 0 : _b.label) !== null && _c !== void 0 ? _c : "Confirm"}
            </button_1.Button>)}
          {!((_d = alertState.cancel) === null || _d === void 0 ? void 0 : _d.hidden) && (<button_1.Button variant="secondary" onClick={function () { return onOpenChange(false); }} loading={pendingCancel}>
              {(_f = (_e = alertState.cancel) === null || _e === void 0 ? void 0 : _e.label) !== null && _f !== void 0 ? _f : "Close"}
            </button_1.Button>)}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>);
};
exports.GlobalAlertDialog = GlobalAlertDialog;
