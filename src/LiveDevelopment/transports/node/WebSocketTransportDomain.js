/*
 * Copyright (c) 2017 - present Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/**
 * WebSocketTransportDomain creates a websocket server for Live Preview
 * It receives the message containing tagID from the Remote Client(onClick)
 * and emits an event which is listened by WebSocketTransport which 
 * brings the cursor to the tag corresponding to that particular tagID
 */

/*eslint-env node */
/*jslint node: true */
"use strict";

var WebSocketServer = require("ws").Server;

/**
 * @private
 * The WebSocket server we listen for incoming connections on.
 * @type {?WebSocketServer}
 */
var _wsServer;

/**
 * @private
 * The WebSocket we use for communication.
 * @type {?WebSocket}
 */
 //var _ws;

/**
 * @private
 * The Brackets domain manager for registering node extensions.
 * @type {?DomainManager}
 */
var _domainManager;

/**
 * @private
 * Creates the WebSocketServer and handles incoming connections.
 */
function _createServer(socketPort) {
    if (!_wsServer) {
        // TODO: make port configurable, or use random port
        _wsServer = new WebSocketServer({port: socketPort});
        //_ws = null;
        _wsServer.on("connection", function (ws) {
            /*console.log("connected", arguments);
            _ws = ws;
            _ws.on('open', function () {
                _ws.send("Got you!");
            });*/
            ws.on("message", function (msg) {
                //console.log("WebSocketServer - received - " + msg);
                var msgObj;
                try {
                    msgObj = JSON.parse(msg);
                } catch (e) {
                    console.error("webSocketTransport: Error parsing message: " + msg);
                    return;
                }

                if (msgObj.type === "message") {
                    _domainManager.emitEvent("webSocketTransport", "message", msgObj.message);
                } else if (msgObj.type === "livedata") {
                    _domainManager.emitEvent("webSocketTransport", "livedata", msgObj.message);
                } else {
                    console.error("webSocketTransport: Got bad socket message type: " + msg);
                }
            }).on("livedata", function (msg) {
                console.log("WebSocketServer - received - " + msg);
                var livedataObj;
                try {
                    livedataObj = JSON.parse(msg);
                } catch (e) {
                    console.error("webSocketTransport: Error parsing livedata: " + msg);
                    return;
                }

                if (livedataObj.type === "livedata") {
                    _domainManager.emitEvent("webSocketTransport", "livedata", livedataObj.message);
                } else {
                    console.error("webSocketTransport: Got bad socket message type: " + msg);
                }
            }).on("error", function (e) {
                console.error("webSocketTransport: Error on socket : " + e);
            }).on("close", function () {
                console.log("webSocketTransport closed");
            });
        }).on("error", function (e) {
            //_ws = null;
            console.error("webSocketTransport: Error on live preview server creation: " + e);
        });
    }
}

/**
 * Initializes the socket server.
 * @param {number} port
 */
function _cmdStart(port) {
    _createServer(port);
}

/**
 * Kill the WebSocketServer
 */
function _cmdClose() {
    if (_wsServer) {
        _wsServer.close();
        _wsServer = null;
    }
}

/**
 * Sends data over the socket
 */
function _sendDataOverSocket(data) {
    console.log(" Sending data to preview page", data);
    _wsServer.clients.forEach(function each(client) {
        client.send(data);
    });
}

/**
 * Initializes the domain and registers commands.
 * @param {DomainManager} domainManager The DomainManager for the server
 */
function init(domainManager) {
    _domainManager = domainManager;
    if (!domainManager.hasDomain("webSocketTransport")) {
        domainManager.registerDomain("webSocketTransport", {major: 0, minor: 1});
    }
    
    domainManager.registerEvent(
        "webSocketTransport",
        "message",
        [
            {
                name: "msg",
                type: "string",
                description: "JSON message from client page"
            }
        ]
    );
    
    domainManager.registerEvent(
        "webSocketTransport",
        "livedata",
        [
            {
                name: "msg",
                type: "string",
                description: "JSON message from client page"
            }
        ]
    );
    
    domainManager.registerCommand(
        "webSocketTransport",       // domain name
        "start",                    // command name
        _cmdStart,                  // command handler function
        false,                      // this command is synchronous in Node
        "Creates the WS server",
        [
            {
                name: "port",
                type: "number",
                description: "Port on which server needs to listen"
            }
        ],
        []
    );
    
    domainManager.registerCommand(
        "webSocketTransport",       // domain name
        "close",                    // command name
        _cmdClose,                  // command handler function
        false,                      // this command is synchronous in Node
        "Kills the websocket server",
        []
    );
    
    domainManager.registerCommand(
        "webSocketTransport",       // domain name
        "send",                     // command name
        _sendDataOverSocket,        // command handler function
        false,                      // this command is synchronous in Node
        "sends data to the client",
        [{
            name: "data",
            type: "string",
            description: "JSON data to client page"
        }],
        []
    );
    
}

exports.init = init;
