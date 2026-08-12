-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,Exceptions,InnerClasses,EnclosingMethod

-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-dontwarn com.getcapacitor.**

-keep class br.com.movecity.passenger.** { *; }

-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

-keep class androidx.datastore.** { *; }
-keepclassmembers class * implements androidx.datastore.preferences.protobuf.MessageLite { *; }
-dontwarn androidx.datastore.**

-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**
