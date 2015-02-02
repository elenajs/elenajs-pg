if (typeof process !== 'undefined' && typeof define === 'undefined') {
    var ejs = require('elenajs'),
        path = require('path');

    var amdConfig = ejs.createConfig({
        packages: [
            {
                name: 'pg',
                location: path.resolve(__dirname, '../../lib')
            }
        ]
    }, path.resolve(__dirname, '../package.json'));

    ejs.require(amdConfig, [__filename]);

} else {
    require([
        'pg!demo',
        'elenajs/logger!pgDemo',
        'elenajs/logging/ConsoleAppender',
    ], function (pg, logger, ConsoleAppender) {
        new ConsoleAppender({});

        var qry = 'SELECT \'{"bar": "baz", "balance": 7.77, "active":false}\'::json as customer;'

        pg.dbConfig.database = 'postgres';
        
        
        pg.query(qry).then(
            function(result) {
                logger.log('Extracted ' + result.rowCount + ' rows');
                pg.disconnect();
            },
            function(err) {
                logger.log('Query error: ' + JSON.stringify(err));
                pg.disconnect();
            },
            function(row) {
                logger.log('Query partial: ' + JSON.stringify(row));
            }
        );


    });
}
