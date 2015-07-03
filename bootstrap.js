// -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; js2-basic-offset: 2; js2-skip-preprocessor-directives: t; -*-
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu } = Components; /*global Components */

Cu.import("resource://gre/modules/Accounts.jsm"); /*global Accounts */
Cu.import("resource://gre/modules/Messaging.jsm"); /*global Messaging */
Cu.import("resource://gre/modules/Prompt.jsm"); /*global Prompt */
Cu.import("resource://gre/modules/Services.jsm"); /*global Services */
Cu.import("resource://gre/modules/WebChannel.jsm"); /*global WebChannel */
Cu.import("resource://gre/modules/XPCOMUtils.jsm"); /*global XPCOMUtils */

let ORIGIN = 'https://accounts.firefox.com';
let SIGNIN_URL = ORIGIN + '/signin?context=iframe&service=sync';
let SETTINGS_URL = ORIGIN + '/settings?context=iframe&service=sync';
let NOTIFICATION_ID = "fxa-web-signin-complete-notification";

// // An example of how to create a string bundle for localization.
// XPCOMUtils.defineLazyGetter(this, "Strings", function() {
//   return Services.strings.createBundle("chrome://youraddon/locale/youraddon.properties");
// });

// // An example of how to import a helper module.
// XPCOMUtils.defineLazyGetter(this, "Helper", function() {
//   let sandbox = {};
//   Services.scriptloader.loadSubScript("chrome://youraddon/content/helper.js", sandbox);
//   return sandbox["Helper"];
// });

let tab = null;

function startSignInFlow(window) {
  tab = window.BrowserApp.addTab(SIGNIN_URL);
}

function completeSignInFlow(window) {
  // Navigate away from the spinner immediately.
  if (tab != null) {
    window.BrowserApp.loadURI(SETTINGS_URL, tab.browser);
  }

  var p = new Prompt({
    window: window,
    title: "Sync enabled",
    message: "Firefox will begin syncing momentarily",
    buttons: ["OK"],
  }).show(function(data) {
    // Do nothing.
  });
}

// var gToastMenuId = null;
var gDoorhangerMenuId = null;
// var gContextMenuId = null;

function loadIntoWindow(window) {
  // gToastMenuId = window.NativeWindow.menu.add("Show Toast", null, function() { showToast(window); });
  gDoorhangerMenuId = window.NativeWindow.menu.add("Sign in to Sync", null, function() { startSignInFlow(window); });
  // gContextMenuId = window.NativeWindow.contextmenus.add("Copy Link", window.NativeWindow.contextmenus.linkOpenableContext, function(aTarget) { copyLink(window, aTarget); });
}

function unloadFromWindow(window) {
  // window.NativeWindow.menu.remove(gToastMenuId);
  window.NativeWindow.menu.remove(gDoorhangerMenuId);
  // window.NativeWindow.contextmenus.remove(gContextMenuId);
}

/**
 * bootstrap.js API
 */
var windowListener = {
  onOpenWindow: function(aWindow) {
    // Wait for the window to finish loading
    let domWindow = aWindow.QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
    function loadListener() {
      domWindow.removeEventListener("load", loadListener, false);
      loadIntoWindow(domWindow);
    };
    domWindow.addEventListener("load", loadListener, false);
  },
  
  onCloseWindow: function(aWindow) {
  },
  
  onWindowTitleChange: function(aWindow, aTitle) {
  }
};


let channel = new WebChannel("account_updates", Services.io.newURI(ORIGIN, null, null));

function startWebChannel() {
  console.log('Starting WebChannel.');
  channel.listen(function (id, data, target) {
    console.log("channel: " + id);
    console.log("data: " + JSON.stringify(data));
    if (data.command == "fxaccounts:can_link_account") {
      Accounts.firefoxAccountsExist().then(function (exist) {
        let response = {
          command: "fxaccounts:can_link_account",
          messageId: data.messageId,
          data: { data: { ok: !exist } }
        };
	      if (exist) {
          let window = Services.wm.getMostRecentWindow("navigator:browser");
          window.NativeWindow.toast.show("Firefox is already signed in to Sync", "short");  
        }
        console.log("sending: " + JSON.stringify(response));
        channel.send(response, target);
      });
    }

    if (data.command == "fxaccounts:login") {
      Messaging.sendRequestForResult({ type: 'Accounts:CreateFirefoxAccountFromJSON', json: data.data })
      .then((result) => {
        console.log("target: " + target);
	      let window = Services.wm.getMostRecentWindow("navigator:browser");
        completeSignInFlow(window);
      }).catch((e) => {
        console.log("e: " + e);
      });
    }
  });
};

function stopWebChannel() {
  console.log('Stopping WebChannel.');
  if (channel) {
    channel.stopListening();
    channel = null;
  }
};

function startup(aData, aReason) {
  console.log('startup: ' + aReason);
  // Load into any existing windows
  let windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    loadIntoWindow(domWindow);
  }

  // Load into any new windows
  Services.wm.addListener(windowListener);

  startWebChannel();
}

function shutdown(aData, aReason) {
  // When the application is shutting down we normally don't have to clean
  // up any UI changes made
  if (aReason == APP_SHUTDOWN) {
    return;
  }

  // Stop listening for new windows
  Services.wm.removeListener(windowListener);

  // Unload from any existing windows
  let windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    unloadFromWindow(domWindow);
  }

  stopWebChannel();
}

function install(aData, aReason) {
  console.log('install: ' + aReason);
}

function uninstall(aData, aReason) {
}
