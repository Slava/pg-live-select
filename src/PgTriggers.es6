var _            = require('lodash');
var EventEmitter = require('events').EventEmitter;

var querySequence = require('./querySequence');
var RowCache      = require('./RowCache');
var RowTrigger    = require('./RowTrigger');
var LiveSelect    = require('./LiveSelect');

class PgTriggers extends EventEmitter {
	constructor(connect, channel) {
		this.connect       = connect;
		this.channel       = channel;
		this.rowCache      = new RowCache;
		this.triggerTables = [];

		this.setMaxListeners(0); // Allow unlimited listeners

		listen.call(this);
		createTables.call(this);
	}

	getClient(cb) {
		if(this.client && this.done) {
			cb(null, this.client, this.done);
		}
		else {
			this.connect((error, client, done) => {
				if(error) return this.emit('error', error);

				this.client = client;
				this.done   = done;

				cb(null, this.client, this.done);
			});
		}
	}

	createTrigger(table) {
		return new RowTrigger(this, table);
	}

	select(query, params) {
		return new LiveSelect(this, query, params);
	}

	cleanup(callback) {
		var { triggerTables, channel } = this;

		var queries = [];

		this.getClient((error, client, done) => {
			if(error) return this.emit('error', error);

			_.forOwn(triggerTables, (tablePromise, table) => {
				var triggerName = `${channel}_${table}`;

				queries.push(`DROP TRIGGER IF EXISTS ${triggerName} ON ${table}`);
				queries.push(`DROP FUNCTION IF EXISTS ${triggerName}()`);
			});

			querySequence(client, queries, (error, result) => {
				if(error) return this.emit('error', error);

				done();

				if(_.isFunction(callback)) {
					callback(null, result);
				}
			});
		});
	}
}

function listen(callback) {
	this.getClient((error, client, done) => {
		if(error) return this.emit('error', error);

		client.query(`LISTEN "${this.channel}"`, function(error, result) {
				if(error) throw error;
			});

			client.on('notification', (info) => {
				if(info.channel === this.channel) {
					this.emit(`change:${info.payload}`);
				}
			});
	});
}

function createTables(callback) {
	var sql = [
		`CREATE TABLE IF NOT EXISTS _liveselect_queries (
			id BIGINT PRIMARY KEY,
			query TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS _liveselect_column_usage (
			id SERIAL PRIMARY KEY,
			query_id BIGINT,
			table_schema VARCHAR(255),
			table_name VARCHAR(255),
			column_name VARCHAR(255)
		)`,
		`TRUNCATE TABLE _liveselect_queries`,
		`TRUNCATE TABLE _liveselect_column_usage`
	];

	this.getClient((error, client, done) => {
		if(error) return this.emit('error', error);

		querySequence(client, sql, (error, result) => {
			if(error) return this.emit('error', error);

			if(_.isFunction(callback)) {
				callback(null, result);
			}
		});
	});
}

module.exports = PgTriggers;
