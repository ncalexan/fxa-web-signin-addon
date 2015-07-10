// -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; js2-basic-offset: 2; js2-skip-preprocessor-directives: t; -*-
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu } = Components; /*global Components */

Cu.import("resource://gre/modules/Accounts.jsm"); /*global Accounts */
Cu.import("resource://gre/modules/Messaging.jsm"); /*global Messaging */
Cu.import("resource://gre/modules/Promise.jsm"); /*global Promise */
Cu.import("resource://gre/modules/Prompt.jsm"); /*global Prompt */
Cu.import("resource://gre/modules/Services.jsm"); /*global Services */
Cu.import("resource://gre/modules/WebChannel.jsm"); /*global WebChannel */
Cu.import("resource://gre/modules/XPCOMUtils.jsm"); /*global XPCOMUtils */

// From https://github.com/mozilla/fxa-dev, development URL scheme is like:
// content server: https://latest.dev.lcip.org
// auth server: https://latest.dev.lcip.org/auth/
// oauth server: https://oauth-latest.dev.lcip.org
// sync tokenserver: https://latest.dev.lcip.org/syncserver/token/1.0/sync/1.5

let SIGNIN = '/signin?context=iframe&service=sync&entrypoint=p11';
let SETTINGS = '/settings?context=iframe&service=sync&entrypoint=p11';
let AUTH = '/auth/v1';
let TOKEN = '/syncserver/token/1.0/sync/1.5';

// An example of how to create a string bundle for localization.
XPCOMUtils.defineLazyGetter(this, "Strings", function() {
  return Services.strings.createBundle("chrome://fxa-web-signin/locale/strings.properties");
}); /*global Strings */

// An example of how to import a helper module.
XPCOMUtils.defineLazyGetter(this, "Helper", function() {
  let sandbox = {};
  Services.scriptloader.loadSubScript("chrome://fxa-web-signin/content/helper.js", sandbox);
  return sandbox["Helper"];
}); /*global Helper*/


function promiseObserverNotified(aTopic) {
  let deferred = Promise.defer();
  Services.obs.addObserver(function onNotification(aSubject, aTopic, aData) {
    Services.obs.removeObserver(onNotification, aTopic);
      deferred.resolve({subject: aSubject, data: aData});
    }, aTopic, false);
  return deferred.promise;
}

function configureSignInToSync(window) {
  let extras = Helper.getPrefs();

  var p = new Prompt({
    window: window,
    title: Strings.GetStringFromName("prompt.title"),
    buttons: [
      Strings.GetStringFromName("prompt.button.save"),
      Strings.GetStringFromName("prompt.button.cancel"),
    ],
  }).addTextbox({
    value: extras.content,
    id: "content",
    hint: Strings.GetStringFromName("prompt.hint.content"),
    autofocus: true,
  });

  p.show(function(data) {
    // "Cancel" does nothing.
    if (data.button == 1 || !data.content) {
      return;
    }

    // Write for next time.
    Helper.setPrefs(data);
    extras.content = data.content;
    // No trailing slashes, please.on
    while (extras.content.endsWith('/')) {
      extras.content = extras.content.substring(0, extras.content.length - 1);
    }
  });
}

var channel = null;

function startWebChannel(origin) {
  console.log('Starting WebChannel for origin: ' + origin);
  channel = new WebChannel("account_updates", Services.io.newURI(origin, null, null));

  channel.listen(function (id, data, target) {
    let window = Services.wm.getMostRecentWindow("navigator:browser");

    console.log("channel: " + id);
    console.log("data: " + JSON.stringify(data));

    if (data.command == "fxaccounts:can_link_account") {
      Accounts.firefoxAccountsExist().then(function (exist) {
        let ok = !exist;
        let response = {
          command: "fxaccounts:can_link_account",
          messageId: data.messageId,
          data: { data: { ok: ok } }
        };
        console.log("sending: " + JSON.stringify(response));
        channel.send(response, target);
	      if (!ok) {
          let toast = Strings.GetStringFromName("accounts.exist.toast");
          window.NativeWindow.toast.show(toast, "short");
        }
      });
    }

    if (data.command == "fxaccounts:login") {
      let json = data.data;
      json.authServerEndpoint = origin + AUTH;
      json.tokenServerEndpoint = origin + TOKEN;
      console.log("got json: " + JSON.stringify(json));
      Messaging.sendRequestForResult({ type: 'Accounts:CreateFirefoxAccountFromJSON', json: json })
        .then(() => {
          Services.obs.notifyObservers(null, "fxaccounts:login", json);
        })
        .then(function (result) {
          var p = new Prompt({
            window: window,
            title: Strings.GetStringFromName("success.title"),
            message: Strings.GetStringFromName("success.message"),
            buttons: [Strings.GetStringFromName("success.button.ok")],
          }).show();
        })
        .catch(Cu.reportError);
    }
  });
}

function stopWebChannel() {
  if (channel != null) {
    console.log('Stopping WebChannel');
    channel.stopListening();
    channel = null;
  }
}

function signInToSync(window) {
  if (channel == null) {
    throw new Error("channel must not be null");
  }

  let extras = Helper.getPrefs();
  console.log("extras are: " + JSON.stringify(extras));

  let tab = window.BrowserApp.addTab(extras.content + SIGNIN);

  return promiseObserverNotified("fxaccounts:login")
    .then(function (result) {
      let redirectURL = extras.content + SETTINGS;
      if (tab != null) {
        window.BrowserApp.loadURI(redirectURL, tab.browser);
      }
      return result;
    })
    .catch(Cu.reportError);
}

// var gToastMenuId = null;
var gDoorhangerMenuId = null;
var gConfigureMenuId = null;
// var gContextMenuId = null;

function loadIntoWindow(window) {
  // gToastMenuId = window.NativeWindow.menu.add("Show Toast", null, function() { showToast(window); });
  // First added appears last (!?).
  let configureTitle = Strings.GetStringFromName("configure.title");
  gConfigureMenuId = window.NativeWindow.menu.add(configureTitle, null, function() { configureSignInToSync(window); });
  let title = Strings.GetStringFromName("menu.title");
  gDoorhangerMenuId = window.NativeWindow.menu.add(title, null, function() { signInToSync(window); });
  // gContextMenuId = window.NativeWindow.contextmenus.add("Copy Link", window.NativeWindow.contextmenus.linkOpenableContext, function(aTarget) { copyLink(window, aTarget); });
}

function unloadFromWindow(window) {
  // window.NativeWindow.menu.remove(gToastMenuId);
  window.NativeWindow.menu.remove(gDoorhangerMenuId);
  window.NativeWindow.menu.remove(gConfigureMenuId);
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


function updateWebChannel() {
  stopWebChannel();

  let origin = Services.io.newURI(Helper.getPrefs().content, null, null).prePath;
  console.log('Updating WebChannel for origin: ' + origin);
  startWebChannel(origin);
}

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

  // Always set the default prefs as they disappear on restart.
  Helper.setDefaultPrefs();

  Services.prefs.addObserver(Helper.PREF_BRANCH + 'content', updateWebChannel, false);
  updateWebChannel();
}

function shutdown(aData, aReason) {
  console.log('startup: ' + aReason);

  // When the application is shutting down we normally don't have to clean
  // up any UI changes made
  if (aReason == APP_SHUTDOWN) {
    return;
  }

  stopWebChannel();
  Services.prefs.removeObserver(Helper.PREF_BRANCH + 'content', updateWebChannel);

  // Stop listening for new windows
  Services.wm.removeListener(windowListener);

  // Unload from any existing windows
  let windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    unloadFromWindow(domWindow);
  }
}

function install(aData, aReason) {
  console.log('install: ' + aReason);
}

function uninstall(aData, aReason) {
  console.log('uninstall: ' + aReason);
}
