import java.util.Properties

plugins {
    id("com.android.application")
}

val ks = Properties().apply { val f = rootProject.file("keystore/keystore.properties"); if (f.exists()) f.inputStream().use { load(it) } }

// Copy the Luciel web app (aero-player) + the Android layer into assets/www before every build.
val syncWeb by tasks.registering(Exec::class) {
    group = "luciel"
    description = "Sync web assets from /workspace/aero-player (or LUCIEL_WEB) into app/src/main/assets/www"
    workingDir = rootProject.projectDir
    commandLine("node", "tools/sync-web.js")
    inputs.dir(rootProject.file("web"))
    inputs.file(rootProject.file("tools/sync-web.js"))
    outputs.dir(file("src/main/assets/www"))
    outputs.upToDateWhen { false }
}
tasks.named("preBuild") { dependsOn(syncWeb) }

android {
    namespace = "com.luciel.player"
    compileSdk = 37
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "com.luciel.player"
        minSdk = 26
        targetSdk = 37
        versionCode = 5
        versionName = "1.1.2"
    }
    signingConfigs {
        create("release") {
            if (ks.isNotEmpty()) {
                storeFile = rootProject.file("keystore/" + ks.getProperty("storeFile"))
                storePassword = ks.getProperty("storePassword"); keyAlias = ks.getProperty("keyAlias"); keyPassword = ks.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug { applicationIdSuffix = ".debug"; versionNameSuffix = "-debug" }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures { buildConfig = true }
    androidResources { noCompress += listOf("webp", "mp4", "webm", "png", "jpg", "woff2", "zip") }
    testOptions { unitTests { isIncludeAndroidResources = true; isReturnDefaultValues = true } }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
        htmlReport = true
        xmlReport = true
        disable += listOf("SetJavaScriptEnabled", "JavascriptInterface")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.webkit:webkit:1.17.1")
    implementation("androidx.documentfile:documentfile:1.1.0")
    implementation("androidx.media3:media3-session:1.11.1")
    implementation("androidx.media3:media3-common:1.11.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
