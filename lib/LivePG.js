'use strict';

var _inherits = require('babel-runtime/helpers/inherits')['default'];

var _get = require('babel-runtime/helpers/get')['default'];

var _createClass = require('babel-runtime/helpers/create-class')['default'];

var _classCallCheck = require('babel-runtime/helpers/class-call-check')['default'];

var _getIterator = require('babel-runtime/core-js/get-iterator')['default'];

var _Promise = require('babel-runtime/core-js/promise')['default'];

var _Object$keys = require('babel-runtime/core-js/object/keys')['default'];

var _regeneratorRuntime = require('babel-runtime/regenerator')['default'];

var EventEmitter = require('events').EventEmitter;
var _ = require('lodash');
var murmurHash = require('murmurhash-js').murmur3;

var common = require('./common');
var SelectHandle = require('./SelectHandle');

/*
 * Duration (ms) to wait to check for new updates when no updates are
 *  available in current frame
 */
var STAGNANT_TIMEOUT = 100;

var LivePG = (function (_EventEmitter) {
  function LivePG(connStr, channel) {
    _classCallCheck(this, LivePG);

    _get(Object.getPrototypeOf(LivePG.prototype), 'constructor', this).call(this);
    this.connStr = connStr;
    this.channel = channel;
    this.notifyHandle = null;
    this.waitingToUpdate = [];
    this.selectBuffer = {};
    this.allTablesUsed = {};
    this.tablesUsedCache = {};
    this.waitingPayloads = {};

    this.ready = this._init();
    this.ready['catch'](this._error);
  }

  _inherits(LivePG, _EventEmitter);

  _createClass(LivePG, [{
    key: '_init',
    value: function _init() {
      var performNextUpdate;
      return _regeneratorRuntime.async(function _init$(context$2$0) {
        var _this = this;

        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            context$2$0.next = 2;
            return common.getClient(this.connStr);

          case 2:
            this.notifyHandle = context$2$0.sent;

            common.performQuery(this.notifyHandle.client, 'LISTEN "' + this.channel + '"')['catch'](this._error);

            // Cache partial payloads in this closure

            this.notifyHandle.client.on('notification', function (info) {
              if (info.channel === _this.channel) {
                var payload = _this._processNotification(info.payload);
                if (payload === null) {
                  return; // Full message has not arrived yet
                }

                try {
                  // See common.createTableTrigger() for payload definition
                  var payload = JSON.parse(payload);
                } catch (error) {
                  return _this._error(new Error('INVALID_NOTIFICATION ' + payload));
                }

                if (payload.table in _this.allTablesUsed) {
                  var _iteratorNormalCompletion = true;
                  var _didIteratorError = false;
                  var _iteratorError = undefined;

                  try {
                    for (var _iterator = _getIterator(_this.allTablesUsed[payload.table]), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                      var queryHash = _step.value;

                      var queryBuffer = _this.selectBuffer[queryHash];
                      if (queryBuffer.triggers
                      // Check for true response from manual trigger
                       && payload.table in queryBuffer.triggers && (payload.op === 'UPDATE'
                      // Rows changed in an UPDATE operation must check old and new
                      ? queryBuffer.triggers[payload.table](payload.new_data[0]) || queryBuffer.triggers[payload.table](payload.old_data[0])
                      // Rows changed in INSERT/DELETE operations only check once
                      : queryBuffer.triggers[payload.table](payload.data[0])) || queryBuffer.triggers
                      // No manual trigger for this table, always refresh
                       && !(payload.table in queryBuffer.triggers)
                      // No manual triggers at all, always refresh
                       || !queryBuffer.triggers) {

                        _this.waitingToUpdate.push(queryHash);
                      }
                    }
                  } catch (err) {
                    _didIteratorError = true;
                    _iteratorError = err;
                  } finally {
                    try {
                      if (!_iteratorNormalCompletion && _iterator['return']) {
                        _iterator['return']();
                      }
                    } finally {
                      if (_didIteratorError) {
                        throw _iteratorError;
                      }
                    }
                  }
                }
              }
            });

            performNextUpdate = (function () {
              var _this2 = this;

              if (this.waitingToUpdate.length !== 0) {
                var queriesToUpdate = _.uniq(this.waitingToUpdate.splice(0, this.waitingToUpdate.length));

                _Promise.all(queriesToUpdate.map(function (queryHash) {
                  return _this2._updateQuery(queryHash);
                })).then(performNextUpdate)['catch'](this._error);
              } else {
                // No queries to update, wait for set duration
                setTimeout(performNextUpdate, STAGNANT_TIMEOUT);
              }
            }).bind(this);

            performNextUpdate();

          case 7:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this);
    }
  }, {
    key: 'select',
    value: function select(query, params, triggers) {
      // Allow omission of params argument
      if (typeof params === 'object' && !(params instanceof Array)) {
        triggers = params;
        params = [];
      } else if (typeof params === 'undefined') {
        params = [];
      }

      if (typeof query !== 'string') throw new Error('QUERY_STRING_MISSING');
      if (!(params instanceof Array)) throw new Error('PARAMS_ARRAY_MISMATCH');

      var queryHash = murmurHash(JSON.stringify([query, params]));
      var handle = new SelectHandle(this, queryHash);

      // Perform initialization asynchronously
      this._initSelect(query, params, triggers, queryHash, handle)['catch'](this._error);

      return handle;
    }
  }, {
    key: 'cleanup',
    value: function cleanup() {
      var pgHandle, _iteratorNormalCompletion2, _didIteratorError2, _iteratorError2, _iterator2, _step2, table;

      return _regeneratorRuntime.async(function cleanup$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            this.notifyHandle.done();

            context$2$0.next = 3;
            return common.getClient(this.connStr);

          case 3:
            pgHandle = context$2$0.sent;
            _iteratorNormalCompletion2 = true;
            _didIteratorError2 = false;
            _iteratorError2 = undefined;
            context$2$0.prev = 7;
            _iterator2 = _getIterator(_Object$keys(this.allTablesUsed));

          case 9:
            if (_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done) {
              context$2$0.next = 16;
              break;
            }

            table = _step2.value;
            context$2$0.next = 13;
            return common.dropTableTrigger(pgHandle.client, table, this.channel);

          case 13:
            _iteratorNormalCompletion2 = true;
            context$2$0.next = 9;
            break;

          case 16:
            context$2$0.next = 22;
            break;

          case 18:
            context$2$0.prev = 18;
            context$2$0.t0 = context$2$0['catch'](7);
            _didIteratorError2 = true;
            _iteratorError2 = context$2$0.t0;

          case 22:
            context$2$0.prev = 22;
            context$2$0.prev = 23;

            if (!_iteratorNormalCompletion2 && _iterator2['return']) {
              _iterator2['return']();
            }

          case 25:
            context$2$0.prev = 25;

            if (!_didIteratorError2) {
              context$2$0.next = 28;
              break;
            }

            throw _iteratorError2;

          case 28:
            return context$2$0.finish(25);

          case 29:
            return context$2$0.finish(22);

          case 30:

            pgHandle.done();

          case 31:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this, [[7, 18, 22, 30], [23,, 25, 29]]);
    }
  }, {
    key: '_initSelect',
    value: function _initSelect(query, params, triggers, queryHash, handle) {
      var queryBuffer, newBuffer, pgHandle, tablesUsed, _iteratorNormalCompletion3, _didIteratorError3, _iteratorError3, _iterator3, _step3, table;

      return _regeneratorRuntime.async(function _initSelect$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            if (!(queryHash in this.selectBuffer)) {
              context$2$0.next = 8;
              break;
            }

            queryBuffer = this.selectBuffer[queryHash];

            queryBuffer.handlers.push(handle);

            context$2$0.next = 5;
            return common.delay();

          case 5:

            // Initial results from cache
            handle.emit('update', { removed: null, moved: null, copied: null, added: queryBuffer.data }, queryBuffer.data);
            context$2$0.next = 54;
            break;

          case 8:
            newBuffer = this.selectBuffer[queryHash] = {
              query: query,
              params: params,
              triggers: triggers,
              data: [],
              handlers: [handle],
              notifications: []
            };
            context$2$0.next = 11;
            return common.getClient(this.connStr);

          case 11:
            pgHandle = context$2$0.sent;
            tablesUsed = undefined;

            if (!(queryHash in this.tablesUsedCache)) {
              context$2$0.next = 17;
              break;
            }

            tablesUsed = this.tablesUsedCache[queryHash];
            context$2$0.next = 21;
            break;

          case 17:
            context$2$0.next = 19;
            return common.getQueryDetails(pgHandle.client, query);

          case 19:
            tablesUsed = context$2$0.sent;

            this.tablesUsedCache[queryHash] = tablesUsed;

          case 21:
            _iteratorNormalCompletion3 = true;
            _didIteratorError3 = false;
            _iteratorError3 = undefined;
            context$2$0.prev = 24;
            _iterator3 = _getIterator(tablesUsed);

          case 26:
            if (_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done) {
              context$2$0.next = 38;
              break;
            }

            table = _step3.value;

            if (table in this.allTablesUsed) {
              context$2$0.next = 34;
              break;
            }

            this.allTablesUsed[table] = [queryHash];
            context$2$0.next = 32;
            return common.createTableTrigger(pgHandle.client, table, this.channel);

          case 32:
            context$2$0.next = 35;
            break;

          case 34:
            if (this.allTablesUsed[table].indexOf(queryHash) === -1) {
              this.allTablesUsed[table].push(queryHash);
            }

          case 35:
            _iteratorNormalCompletion3 = true;
            context$2$0.next = 26;
            break;

          case 38:
            context$2$0.next = 44;
            break;

          case 40:
            context$2$0.prev = 40;
            context$2$0.t1 = context$2$0['catch'](24);
            _didIteratorError3 = true;
            _iteratorError3 = context$2$0.t1;

          case 44:
            context$2$0.prev = 44;
            context$2$0.prev = 45;

            if (!_iteratorNormalCompletion3 && _iterator3['return']) {
              _iterator3['return']();
            }

          case 47:
            context$2$0.prev = 47;

            if (!_didIteratorError3) {
              context$2$0.next = 50;
              break;
            }

            throw _iteratorError3;

          case 50:
            return context$2$0.finish(47);

          case 51:
            return context$2$0.finish(44);

          case 52:

            pgHandle.done();

            // Retrieve initial results
            this.waitingToUpdate.push(queryHash);

          case 54:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this, [[24, 40, 44, 52], [45,, 47, 51]]);
    }
  }, {
    key: '_updateQuery',
    value: function _updateQuery(queryHash) {
      var pgHandle, queryBuffer, update, _iteratorNormalCompletion4, _didIteratorError4, _iteratorError4, _iterator4, _step4, updateHandler;

      return _regeneratorRuntime.async(function _updateQuery$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            context$2$0.next = 2;
            return common.getClient(this.connStr);

          case 2:
            pgHandle = context$2$0.sent;
            queryBuffer = this.selectBuffer[queryHash];
            context$2$0.next = 6;
            return common.getResultSetDiff(pgHandle.client, queryBuffer.data, queryBuffer.query, queryBuffer.params, queryHash);

          case 6:
            update = context$2$0.sent;

            pgHandle.done();

            if (!(update !== null)) {
              context$2$0.next = 29;
              break;
            }

            queryBuffer.data = update.data;

            _iteratorNormalCompletion4 = true;
            _didIteratorError4 = false;
            _iteratorError4 = undefined;
            context$2$0.prev = 13;
            for (_iterator4 = _getIterator(queryBuffer.handlers); !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
              updateHandler = _step4.value;

              updateHandler.emit('update', filterHashProperties(update.diff), filterHashProperties(update.data));
            }
            context$2$0.next = 21;
            break;

          case 17:
            context$2$0.prev = 17;
            context$2$0.t2 = context$2$0['catch'](13);
            _didIteratorError4 = true;
            _iteratorError4 = context$2$0.t2;

          case 21:
            context$2$0.prev = 21;
            context$2$0.prev = 22;

            if (!_iteratorNormalCompletion4 && _iterator4['return']) {
              _iterator4['return']();
            }

          case 24:
            context$2$0.prev = 24;

            if (!_didIteratorError4) {
              context$2$0.next = 27;
              break;
            }

            throw _iteratorError4;

          case 27:
            return context$2$0.finish(24);

          case 28:
            return context$2$0.finish(21);

          case 29:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this, [[13, 17, 21, 29], [22,, 24, 28]]);
    }
  }, {
    key: '_processNotification',
    value: function _processNotification(payload) {
      var argSep = [];

      // Notification is 4 parts split by colons
      while (argSep.length < 3) {
        var lastPos = argSep.length !== 0 ? argSep[argSep.length - 1] + 1 : 0;
        argSep.push(payload.indexOf(':', lastPos));
      }

      var msgHash = payload.slice(0, argSep[0]);
      var pageCount = payload.slice(argSep[0] + 1, argSep[1]);
      var curPage = payload.slice(argSep[1] + 1, argSep[2]);
      var msgPart = payload.slice(argSep[2] + 1, argSep[3]);
      var fullMsg = undefined;

      if (pageCount > 1) {
        // Piece together multi-part messages
        if (!(msgHash in this.waitingPayloads)) {
          this.waitingPayloads[msgHash] = _.range(pageCount).map(function (i) {
            return null;
          });
        }
        this.waitingPayloads[msgHash][curPage - 1] = msgPart;

        if (this.waitingPayloads[msgHash].indexOf(null) !== -1) {
          return null // Must wait for full message
          ;
        }

        fullMsg = this.waitingPayloads[msgHash].join('');

        delete this.waitingPayloads[msgHash];
      } else {
        // Payload small enough to fit in single message
        fullMsg = msgPart;
      }

      return fullMsg;
    }
  }, {
    key: '_error',
    value: function _error(reason) {
      this.emit('error', reason);
    }
  }]);

  return LivePG;
})(EventEmitter);

module.exports = LivePG;
// Expose SelectHandle class so it may be modified by application
module.exports.SelectHandle = SelectHandle;

function filterHashProperties(diff) {
  if (diff instanceof Array) {
    return diff.map(function (event) {
      return _.omit(event, '_hash');
    });
  }
  // Otherwise, diff is object with arrays for keys
  _.forOwn(diff, function (rows, key) {
    diff[key] = filterHashProperties(rows);
  });
  return diff;
}
// Initialize neverending loop to refresh active result sets
// Give a chance for event listener to be added

// Initialize result set cache