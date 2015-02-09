define([
    "elenajs/declare",
    "elenajs/_base/Mixin",
    "dojo/_base/lang",
    "dojo/Evented",
    "dojo/Deferred",
    "dojo/topic",
    "elenajs/node!pg"
], function (
    declare,
    Mixin,
    lang,
    Evented,
    Deferred,
    topic,
    pg) {

    return declare("pg/ConnectionPool", [Mixin, Evented], {
        dbConfig: null,
        poolSize: 10,
        poolName: null,
        busyClients: 0,
        pool: null,
        _commandsQueue: null,
        /**
         * required 
         * poolName: <String::required>,
         * poolSize: <Integer::default=10::less than 1 is inifinite>,
         * dbConfig <Object::{
         *   database: <string::required>,
         *   host: <string::default 127.0.0.1>,
         *   port: <integer::default 5432>,
         *   user: <String::default to process.env.USERNAME>,         
         *   password: <String>,         
         *   ssl: <Boolean::default false>,         
         * }>
         */
        constructor: declare.superCall(function (sup) {
            return function () {
                var self = this,
                    args = Array.prototype.slice.call(arguments);

                this.pool = [];
                this._commandsQueue = [];
                this.dbConfig = {
                    host: '127.0.0.1',
                        port: '5432',
                        user: process.env.USERNAME,
                        password: null,
                        ssl: false
                };
                if (args.length > 0 && 'dbConfig' in args[0]) {
                    var paramDbConfig = args[0].dbConfig;
                    args[0].dbConfig = lang.mixin(self.dbConfig, paramDbConfig);
                }
                sup.apply(this, args);
                ['SIGTERM', 'SIGINT', 'exit'].forEach(function (signal) {
                    process.on(signal, function () {
                        self.disconnect();
                    });
                });
            };
        }),
        disconnect: function () {
            this.pool.forEach(function (client) {
                client.end();
            });
        },
        query: function (text, values, name) {
            var self = this,
                deferred = new Deferred(),
                queryObject = {};
            if (typeof text === 'object') {
                queryObject = text;
            } else {
                queryObject.text = text;
                if (values)
                    queryObject.values = [].concat(values);
                if (name)
                    queryObject.name = name;
            }
            queryObject.dfd = deferred;
            this._commandsQueue.push(queryObject);
            setImmediate(function () {
                self.perform();
            });
            return deferred;
        },
        releaseClient: function (client, discard) {
            var self = this;
            this.busyClients -= 1;
            if (this.clientsNumber < this.poolSize) {
                !discard && this.pool.push(client);
                setImmediate(function () {
                    self.perform();
                });
            } else if (client.eventListeners) {
                client.end();
            }
        },
        createClient: function () {
            var self = this,
                client = new pg.Client(self.dbConfig);

            client.on('error', function (err) {
                topic.publish(self.poolName + '/error', err);
                self.releaseClient(client, true);
            });
            client.connect();

            return client;
        },
        perform: function () { //<-------------------------------------------------------THE GAME --------------------------------------------
            if (this._commandsQueue.length < 1 || (this.poolSize > 0 && this.busyClients >= this.poolSize)) {
                return;
            }

            var self = this,
                cmdObj = this._commandsQueue.shift(),
                pool = this.pool,
                client = pool.shift();

            if (!client && (this.poolSize < 1 || this.clientsNumber < this.poolSize)) {
                client = this.createClient();
            }

            if (client) {
                client.commandDeferredResult = cmdObj.dfd;
                delete cmdObj.dfd;
                var self = this,
                    query = client.query(cmdObj),
                    releaseQuery = function (qry, discardClient) {
                        qry.removeAllListeners();
                        qry.errorHandler.remove();
                        self.releaseClient(qry.client, discardClient);
                    };
                this.busyClients += 1;
                query.client = client;
                query.errorHandler = topic.subscribe(self.poolName + '/error', function (err) {
                    console.error(err);
                    client.commandDeferredResult.reject(err);
                    releaseQuery(query, true);
                });

                query.on('error', function (err) {
                    releaseQuery(query);
                    client.commandDeferredResult.reject(err);
                });
                query.on('row', function (row) {
                    client.commandDeferredResult.progress(row);
                });
                query.on('end', function (result) {                    
                    releaseQuery(query);
                    client.commandDeferredResult.resolve(result);
                });
                return client.commandDeferedResult;
            } else {
                this._commandsQueue.push(cmdObj);
            }
        }
    }, {
        clientsNumber: {
            get: function () {
                return this.pool.length + this.busyClients;
            }
        }
    });
});