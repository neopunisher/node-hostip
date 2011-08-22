var xml2js = require('xml2js'),
    request = require('request');

exports.lookup = function (ip,cb){
request({uri: "http://api.hostip.info/?ip="+ip}, function (error, response, body) {
var parser = new xml2js.Parser();
parser.addListener('end', function(obj){
cb(null,obj);
});
parser.parseString(body);
});
}
