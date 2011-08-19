var util = require('util'),
    clr = require('colors'),
    xml2js = require('xml2js'),
    _ = require('underscore')._,
    request = require('request');

//exports.lookup = function (ip,cb){
function lookup(ip,cb){
request({uri: "http://api.hostip.info/?ip="+ip}, function (error, response, body) {
var parser = new xml2js.Parser();
parser.addListener('end', function(obj){
cb(null,obj);
});
parser.parseString(body);
});
}

lookup('184.106.162.99',function(err,obj){
console.log(util.inspect(obj,true,10).yellow);
});
