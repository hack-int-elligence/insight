var express = require('express');
var debug = require('debug')('geocode');
var fb = require('fb');
var moment = require('moment');
var request = require('request');

var g_API_key = ['AIzaSyD4C_0grHO3gWxgCLGbndJy_ejDXbKNDXk', ];
var g_API_key_offset = 0;

var hat = require('hat');
var request = require('request');

var YALE_API_BASE_URL = 'https://gw.its.yale.edu';
var YALE_API_KEY = '';

var THRESHOLD = 15;

/*
 * Haversine calculation utilities
 */
// utility
var toRadians = function(angle) {
    return angle * (Math.PI / 180);
};
// calculates true relative heading
var haversineAngle = function(latitude1, longitude1, latitude2, longitude2) {
    var y = Math.sin(toRadians(longitude2 - longitude1)) * Math.cos(toRadians(latitude2));
    var x = Math.cos(toRadians(latitude1)) * Math.sin(toRadians(latitude2)) - Math.sin(toRadians(latitude1)) * Math.cos(toRadians(latitude2)) * Math.cos(toRadians(longitude2 - longitude1));
    var brng = Math.atan2(y, x);
    brng = brng * 180 / Math.PI;
    // normalize bearing to give true heading between 0-360
    brng = (brng < 0) ? brng + 360 : brng;
    // return a rounded version
    return Math.round(brng);
};

// calculates true relative distance
var haversineDistance = function(latitude1, longitude1, latitude2, longitude2) {
    var R = 6371000; // the earth's radius in metres
    // azimuth/attitude angles
    // toRadians(latitude1)
    // toRadians(latitude2)
    // toRadians(latitude2 - latitude1)
    // toRadians(longitude2 - longitude1)
    var a = Math.sin(toRadians(latitude2 - latitude1) / 2) * Math.sin(toRadians(latitude2 - latitude1) / 2) +
        Math.cos(toRadians(latitude1)) * Math.cos(toRadians(latitude2)) *
        Math.sin(toRadians(longitude2 - longitude1) / 2) * Math.sin(toRadians(longitude2 - longitude1) / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return (R * c);
};

/*
 * Sorting utility for arrays of objects
 * Takes an array of objects and a key, and sorts based on the key cast to a number
 */
var sortByKey = function(array, key) {
    return array.sort(function(a, b) {
        var x = Number(a[key]);
        var y = Number(b[key]);
        return ((x < y) ? -1 : ((x > y) ? 1 : 0));
    });
};

/*
 * "Inverts" arrays of locations
 * Converts an array of locations to an object with keys of rounded headings mapping to
 * arrays of locations sorted by distance in increasing order
 */
var invertHeadingsFromArray = function(array) {
    var obj = {},
        singHeading;
    array.forEach(function(element) {
        singHeading = Number(element['heading']);
        // instantiate new array if the key isn't already contained
        if (obj.hasOwnProperty(singHeading)) {
            obj[singHeading].push(element);
        } else {
            obj[singHeading] = [];
            obj[singHeading].push(element);
        }
    });
    // sort each corresponding heading array in the object
    for (var heading in obj) {
        sortByKey(obj[heading], 'distance');
    }
    return obj;
};

/*
 * Gets Yale building data, for YHack demo
 */
var getYaleBuildings = function(callback) {
    var buildingDataFeed = YALE_API_BASE_URL + '/soa-gateway/buildings/feed?type=json?apikey=' + YALE_API_KEY;
    var requestURL = encodeURIComponent(buildingDataFeed);
    request(requestURL, function(error, response, body) {
        if (!error && response.statusCode == 200) {
            // JSON of building data is in 'body'
            // contains a lot of information, the keys of which can be standardised based on app needs
            callback(body);
        } else {
            // return empty array so that the rest of the data is unspoiled
            callback([]);
        }
    });
};

var router = express.Router();

router.get('/', function(req, res) {
    res.render('index');
});

router.post('/fb_checkin', function(req, res) {
    var FB = require('fb');
    FB.setAccessToken(req.body.authToken);
    // first find the closest page location using FQL radius search of 50m
    FB.api('fql', {
        q: 'SELECT page_id,name,latitude,longitude FROM place WHERE distance(latitude, longitude, ' + req.body.latitude + ', ' + req.body.longitude + ') < 50'
    }, function(response) {
        if (!response || res.error) {
            console.log(!res ? 'error occurred' : res.error);
            res.send(res.error);
        } else {
            // check to see the place even exists
            if (response.data && response.data.length > 0) {
                // use the first place returned
                var place_details = response.data[0];
                console.log(placeDetails);
                var place_id = '';
                // currently set to private for testing
                FB.api('me/feed', 'post', {
                    body: 'I just checked in here!',
                    place: place_id,
                    privacy: {
                        value: 'SELF'
                    }
                }, function(checkinResponse) {
                    console.log(checkinResponse);
                    res.status(200).send(checkinResponse);
                });
            } else {
                // if no page found, send back error
                res.status(500).send('No location found for those coordinates. Check-in failed.')
            }
        }
    });
});

router.post('/fb_events', function(req, res) {
    // announce
    console.log('Making FB event request for current latitude ' + Number(req.body.latitude) + ' and longitude ' + Number(req.body.longitude));
    // parse radius
    var radius = req.body.radius || '500';

    var FB = require('fb');
    FB.setAccessToken(req.body.authToken);
    FB.api('me/events', function(events) {
        if (!events || events.error) {
            console.log(!events ? 'error occurred' : events.error);
            res.send(events.error);
        }
        var acceptedEvents = [];
        for (var i = 0; i < events.data.length; i++) {
            var event = events.data[i];
            if (event.place.location && event.place.location.latitude && event.place.location.longitude) {
                // check to see it has geocodable data & build epoch stamp
                var event_time = moment(event.start_time);
                // should be >= current time on the same day
                if (event_time.isAfter() && event_time.isSame(new Date(), 'day')) {
                    event.heading = haversineAngle(
                        // your location
                        Number(req.body.latitude),
                        Number(req.body.longitude),
                        // location of resulting place
                        event.place.location.latitude,
                        event.place.location.longitude
                    );
                    event.distance = haversineDistance(
                        // your location
                        Number(req.body.latitude),
                        Number(req.body.longitude),
                        // location of resulting place
                        event.place.location.latitude,
                        event.place.location.longitude
                    );
                    // make sure the event is in radius
                    if (event.distance <= Number(radius)) {
                        acceptedEvents.push(event);
                    }
                }
            }
        }
        // process events before sending
        var responseObj = invertHeadingsFromArray(acceptedEvents);
        res.send(responseObj);
    });
});

router.post('/insight', function(req, res) {
    // require the google places module inside the route handler to change the config key
    var googleplaces = require('googleplaces')(g_API_key[g_API_key_offset], 'json');
    // announce
    console.log('Making request for latitude ' + Number(req.body.latitude) + ' and longitude ' + Number(req.body.longitude));

    // start a RadarSearch via the Google Places API
    // use default radius as 500m
    // default seach category is 'restaurants'
    googleplaces.radarSearch({
        location: [Number(req.body.latitude), Number(req.body.longitude)],
        radius: req.body.radius || '500',
        types: req.body.categories || ['restaurant']
    }, function(error, response) {
        if (error) {
            // if there's an error, send back the error
            res.send(error);
        } else {
            // for every place reference in the response, gather meta-info
            var placeDetails = [];
            // only gather info for the first <THRESHOLD> references
            var resultCount = THRESHOLD;

            console.log('found ' + response.results.length + ' results');
            console.log('Extracting information for the top: ' + THRESHOLD);

            /*
             * Parse API call results, if valid, process/send response
             */
            if (response.results.length > 0) {
                var bearing, abs_distance;
                for (var i = 0; i < THRESHOLD; i++) {
                    // using the reference field, make individual PlaceDetails requests via the Places API
                    googleplaces.placeDetailsRequest({
                        reference: response.results[i].reference
                    }, function(detailsErr, details) {
                        // call/calculate true heading
                        bearing = haversineAngle(
                            // your location
                            Number(req.body.latitude),
                            Number(req.body.longitude),
                            // location of resulting place
                            details.result.geometry.location.lat,
                            details.result.geometry.location.lng
                        );
                        abs_distance = haversineDistance(
                            // your location
                            Number(req.body.latitude),
                            Number(req.body.longitude),
                            // location of resulting place
                            details.result.geometry.location.lat,
                            details.result.geometry.location.lng
                        );
                        // must have lat/long geometry for insight
                        if (details.result.geometry) {
                            // push only relevent API response information
                            placeDetails.push({
                                name: details.result.name,
                                location: details.result.geometry.location,
                                icon: details.result.icon,
                                place_id: details.result.place_id,
                                address: details.result.formatted_address,
                                website: details.result.website,
                                heading: bearing,
                                distance: abs_distance
                            });
                            // IMPORTANT: do not modify
                            // async check counter (only sends response when all meta-inf has been retrieved)
                            if (placeDetails.length == resultCount) {
                                // add in yale building data - should currently fail and return original data without API key
                                getYaleBuildings(function(buildingArray) {
                                    // will currently concat an empty array; NBD
                                    placeDetails.concat(buildingArray);
                                    // process array of results into formatted object
                                    var responseObj = invertHeadingsFromArray(placeDetails);
                                    res.send(responseObj);
                                });
                            }
                        } else {
                            // decrement check counter if result does not have geometry
                            resultCount -= 1;
                        }
                    });
                }
            } else {
                res.send({});
            }
        }
    });
});

module.exports = router;