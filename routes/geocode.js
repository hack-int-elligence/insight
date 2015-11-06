var express = require('express');
var debug = require('debug')('geocode');
var fb = require('fb');
var moment = require('moment');

var g_API_key = ['AIzaSyD4C_0grHO3gWxgCLGbndJy_ejDXbKNDXk', ];
var g_API_key_offset = 0;

var hat = require('hat');
var request = require('request');

var THRESHOLD = 15;

var router = express.Router();

router.get('/', function(req, res) {
	res.render('index');
});

router.get('/fb_events', function(req, res) {
	var FB = require('fb');
	FB.setAccessToken('CAAJlnCaKfaEBAFko2yc6QQX8W90tzPF5xtO4pZCmJeLRXWhM0ZAqlLsB7Cqyllhjlqj09ZB0GT588jJdmGTu3oKmwu8RBD05vaPvjQRflQYlcIe0gNQSdBog7znxqylAweFYbdWIhHztx6t9ZCVqCCnIzSZAyZBGCbanPuIWpZAOT3hR1XV6zllt6b2KEnfWgZAYEg3MaFFyQWvpwXgS1fooX0L1TFSshmV59BOF7o9wagZDZD' || req.body.authToken);
	FB.api('me/events', function(events) {
		if (!events || events.error) {
			console.log(!events ? 'error occurred' : events.error);
			res.send(events.error);
		}
		res.send(events);
	});
});

router.post('/insight', function(req, res) {
	// require the google places module inside the route handler to change the config key
	var googleplaces = require('googleplaces')(g_API_key[g_API_key_offset], 'json');

	// start a RadarSearch via the Google Places API
	// use default radius as 500m
	// default seach category is 'restaurants'
	googleplaces.radarSearch({
		location: [Number(req.body.latitude), Number(req.body.longitude)],
		radius: req.body.radius || '500',
		types: ['restaurant']
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
			console.log('Extracting information for the top: ' + THRESHOLD)

			if (response.results.length > 0) {
				for (var i = 0; i < THRESHOLD; i++) {
					// using the reference field, make individual PlaceDetails requests via the Places API
					googleplaces.placeDetailsRequest({
						reference: response.results[i].reference
					}, function(detailsErr, details) {
						// must have lat/long geometry for insight
						if (details.result.geometry) {
							// push only relevent API response information
							placeDetails.push({
								name: details.result.name,
								location: details.result.geometry.location,
								icon: details.result.icon,
								place_id: details.result.place_id,
								address: details.result.formatted_address,
								website: details.result.website
							});
							// IMPORTANT: do not modify
							// async check counter (only sends response when all meta-inf has been retrieved)
							if (placeDetails.length == resultCount) {
								res.send(placeDetails);
							}
						} else {
							// decrement check counter if result does not have geometry
							resultCount -= 1;
						}
					});
				}
			} else {
				res.send([]);
			}
		}
	});
});

module.exports = router;