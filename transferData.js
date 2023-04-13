// Import required modules
require('dotenv').config();
const Airtable = require('airtable');
const axios = require('axios');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { Readable } = require('stream');
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);

// Initialize Airtable
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_TOKEN,
});
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
const tableName = process.env.AIRTABLE_TABLE_NAME;

// Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'enaccessmaps-bcd54.appspot.com',
});
const firestore = admin.firestore();
const collectionName = process.env.FIREBASE_COLLECTION_NAME;

// Initialize Google Maps API
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_MAPS_PLACES_API_BASE_URL = 'https://maps.googleapis.com/maps/api/place';

// Function to fetch place ID from Google Maps using text search API
const fetchPlaceID = async (location, query) => {
    const apiUrl = `${GOOGLE_MAPS_PLACES_API_BASE_URL}/textsearch/json?key=${GOOGLE_MAPS_API_KEY}&input=${query}`
      + `&location=${location.latitude},${location.longitude}`
      + `&types=restaurant|cafe|food`
      + `&radius=5000`;
  
    const res = await axios.get(apiUrl);

    if (res) {
      const {
        data: { results },
      } = res;
      console.log("place id is:", results[0]?.place_id);
      console.log("for place", query);

      return results.length > 0 ? results[0].place_id : null;
    }
  };

// functions to write photos to storage
const storage = admin.storage().bucket();


async function checkIfPhotoExists(filename) {
  try {
    const [files] = await storage.getFiles({ prefix: `photos/${filename}` });
    return files.length > 0;
  } catch (error) {
    console.error(`Error checking if photo exists: ${error}`);
    return false;
  }
}

async function getExistingPhotoObject(filename) {
  try {
    const [files] = await storage.getFiles({ prefix: `photos/${filename}` });
    const file = files[0];

    if (file) {
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: '03-17-2025',
      });

      return {
        url: signedUrl,
        uuid: file.name.split('/')[1],
      };
    } else {
      console.error('File not found.');
      return null;
    }
  } catch (error) {
    console.error(`Error getting existing photo object: ${error}`);
    return null;
  }
}

async function uploadPhotoAsync(url) {
  try {
    // Download the photo from the given URL
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'arraybuffer', // Change responseType to arraybuffer
    });

    // Check if the content type is image/jpeg
    const contentType = response.headers['content-type'];
    let imageData = response.data;

    if (contentType !== 'image/jpeg') {
      // Convert non-JPEG images to JPEG
      imageData = await sharp(imageData).jpeg().toBuffer();
    }

    // Generate a UUID for the new photo
    const uuid = uuidv4();
    const filename = `photos/${uuid}`;

    // Upload the photo to Firebase Storage
    const file = storage.file(filename);
    const writeStreamOptions = {
      metadata: {
        contentType: 'image/jpeg', // Set content type to image/jpeg
      },
    };
    await new Promise((resolve, reject) => {
      const writeStream = file.createWriteStream(writeStreamOptions);
      const readStream = Readable.from(imageData); // Use Readable.from() method
      readStream
        .pipe(writeStream)
        .on('error', reject)
        .on('finish', resolve);
    });

    // Generate a signed URL for the uploaded photo
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: '03-17-2025',
    });

    return {
      url: signedUrl,
      uuid,
    };
  } catch (error) {
    console.error(`Error uploading photo: ${error}`);
    return null;
  }
}
// function to transform airtable responses to correct format
function transformResponse(response) {
  switch (response) {
    case "Yes":
      return 'yes';
    case "No":
      return 'no';
    case "Unsure":
      return 'unsure';
    case "N/A no steps on entry":
      return 'na';
    default:
      return 'unsure';
  }
}

// Function to transfer data from Airtable to Firebase
const transferData = async () => {
    try {
      let iteratereview = 0
      const records = await base(tableName)
        .select()
        .all();
  
      const batch = firestore.batch();
  
      for (const record of records) {
        const address = record.get('Address') + " " + record.get("Suburb")
        const location = { // Replace with actual latitude and longitude values
          latitude: 0,
          longitude: 0,
        };
  
        const placeID = await fetchPlaceID(location, address);
        const placeRating = record.get('Overall rating (out of 5)')
  
        if (placeID && (placeRating!= undefined)) {

          //Allocate 

          const photoAttachments = record.get("Any photos") || [];

          const photoObjects = await Promise.all(
            photoAttachments.map(async (attachment) => {
              const { url, filename } = attachment;
  
              // Check if the photo is already in Firebase Storage using its filename or UUID
              const photoExists = await checkIfPhotoExists(filename); // Implement this function
  
              if (!photoExists) {
                // Upload the photo if it's not in Firebase Storage
                const photoObject = await uploadPhotoAsync(url);
                return photoObject;
              } else {
                // Use the existing photo in Firebase Storage
                const existingPhotoObject = await getExistingPhotoObject(filename); // Implement this function
                return existingPhotoObject;
              }
            })
          );

          const review = {
            userUid: "Legacy-Airtable",
            userName: record.get('Mailing List - First Name') ? record.get('Mailing List - First Name') : "Anonymous",
            rating: parseInt(record.get('Overall rating (out of 5)')),
            placeId: placeID,
            stepsOnEntry: parseInt(record.get('Steps on Entry')) ?? 0,
            hasStableRamp: transformResponse(record.get('Stable ramp')),
            wcFitsTable: transformResponse(record.get('Table Access')),
            hasMovementSpace: transformResponse(record.get('Sufficient Movement Space')),
            hasAccessibleToilet: transformResponse(record.get('Wheelchair Accessible Toilet')),
            hasAccessibleParking: transformResponse(record.get('Accessible Parking')),
            hasOutdoorEating: transformResponse(record.get('Outdoor Eating')),
            comment: record.get('Other comment') ?? "",
            createdAt: new Date(2021, 01),
            photos: photoObjects // Add photos from the Airtable record if needed
          };
          
          
  
          const reviewsCollection = firestore.collection(collectionName).doc(placeID).collection("reviews");
          const newReviewDoc = reviewsCollection.doc();
          batch.set(newReviewDoc, review);
          console.log("review set: ", iteratereview)
          console.log(review)
          iteratereview++
        }
      }
  
      await batch.commit();
      console.log('Data transferred successfully from Airtable to Firebase.');
    } catch (error) {
      console.error('Error transferring data:', error);
    }
  };

// Execute the transfer
transferData();
