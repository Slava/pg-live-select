// pg-live-select example
// To use example query from livequery.sql, load sample-data.sql into database
var fs = require('fs');
var path = require('path');
var util = require('util');
var LivePg = require('../');

// Update this line with your username/password/host/database
var CONN_STR = 'postgres://imslavko@127.0.0.1/test';
// Load the SELECT query from an external file
var QUERY = 'SELECT * FROM employees ORDER BY id';

// Initialize the live query processor
var liveDb = new LivePg(CONN_STR, 'mytest');

var table = {};
// Create a live select instance
liveDb.select(QUERY, [ ])
  .on('update', function(diff) {
    // Handle the changes here...
    console.log(util.inspect(diff, {depth: 3}));

    diff.added.forEach(function (d) {
      table[d.id] = d;
    });
    diff.changed.forEach(function (ds) {
      table[ds[0].id] = ds[1];
    });
    diff.removed.forEach(function (d) {
      delete table[d.id];
    });

    console.log(table);

    console.log();
  });

// On Ctrl+C, remove triggers and exit
process.on('SIGINT', function() {
  liveDb.cleanup(process.exit);
});
