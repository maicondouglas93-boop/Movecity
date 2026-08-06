# MoveCity Motorista — R8/ProGuard (Capacitor + Firebase + plugins nativos)

-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# Capacitor bridge / plugins
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-dontwarn com.getcapacitor.**

# App nativo MoveCity
-keep class br.com.movecity.driver.** { *; }

# Capawesome FGS
-keep class io.capawesome.capacitorjs.** { *; }
-dontwarn io.capawesome.capacitorjs.**

# Firebase / Play Services
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Kotlin / DataStore (Firebase Installations)
-keep class androidx.datastore.** { *; }
-keepclassmembers class * implements androidx.datastore.preferences.protobuf.MessageLite { *; }
-dontwarn androidx.datastore.**

# EncryptedSharedPreferences / Tink
-keep class androidx.security.crypto.** { *; }
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**

# Cordova compat layer used by Capacitor
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**
