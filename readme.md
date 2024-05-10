## How to run?
make a .env and insert your:

AIRTABLE_API_TOKEN=
AIRTABLE_BASE_ID=
AIRTABLE_TABLE_NAME=
FIREBASE_SERVICE_ACCOUNT_PATH=
FIREBASE_COLLECTION_NAME=places
GOOGLE_MAPS_API_KEY=

then install packages using npm or yarn (just type "yarn"), then run

node ./transferData.js

# What is transferred and what isnt?
What isn't:
- Things that google maps can't find (about 10-20 places)
- *things that don't have star reviews (I didn't want to guess). Easily fixed if undefined have 5 star, but do you really want to do that?* (80+ items!!!)*

What is muddy:
- Google maps api isn't foolproof. Some errors may occur in the address guessing and some places may be completely wrong
- Address that the reviews were created at were feb 1st 2021
- Userid is "Legacy-Airtable"
- Username is "anonymous" if they don't have a name

# To do:
- Clean up data to be definite yes/no/unsure/na, some data is still DIRTY!!!
- Make sure google functions automatically ranks it after upload
- Finally change the upload directory to places instead of test
- Test out the data so the app doesn't crash


