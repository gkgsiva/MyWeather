The MyWeather release signing key, locked with the SIGNING_PASSWORD
repository secret (openssl enc -aes-256-cbc -pbkdf2 -iter 600000).
Made and read by .github/workflows/android-apk.yml on main.
Don't delete this branch or change the secret: installed apps could
then no longer be updated in place.
