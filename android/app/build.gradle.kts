// app/build.gradle.kts – Sport-App (Android), Version 0.14.0 (2026-11-18)
//
// Signatur: Die GitHub Action legt den Schlüssel aus dem Secret ANDROID_KEYSTORE_B64 ab
// und übergibt Pfad und Passwort als Umgebungsvariablen. Ohne diese Variablen wird
// mit dem Debug-Schlüssel signiert (nur für lokale Versuche, nicht updatefähig).
// versionCode kommt aus der Laufnummer der Action (-PversionCode=…), damit jede
// neue APK eine höhere Nummer hat.

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appVersion = "0.14.0"
val laufNummer = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
val schluesselPfad: String? = System.getenv("SPORT_KEYSTORE")
val schluesselPasswort: String? = System.getenv("SPORT_KEYSTORE_PASSWORT")

android {
    namespace = "de.obitus.sport"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.obitus.sport"
        minSdk = 30
        targetSdk = 35
        versionCode = laufNummer
        versionName = "$appVersion ($laufNummer)"
    }

    signingConfigs {
        if (schluesselPfad != null && schluesselPasswort != null) {
            create("sport") {
                storeFile = file(schluesselPfad)
                storePassword = schluesselPasswort
                storeType = "pkcs12"
                keyAlias = "sport"
                keyPassword = schluesselPasswort
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("sport") ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
