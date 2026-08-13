package br.com.movecity.passenger;

import android.os.CancellationSignal;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.google.firebase.auth.AuthCredential;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.GoogleAuthProvider;

import java.util.concurrent.Executor;

/** Login Google nativo do passageiro, sem popup/redirect dentro do WebView. */
@CapacitorPlugin(name = "PassengerGoogleAuth")
public class PassengerGoogleAuthPlugin extends Plugin {
    @PluginMethod
    public void signIn(PluginCall call) {
        int clientIdResource = getContext().getResources().getIdentifier(
            "default_web_client_id",
            "string",
            getContext().getPackageName()
        );
        if (clientIdResource == 0) {
            call.reject(
                "Login Google não configurado: atualize o google-services.json do passageiro.",
                "GOOGLE_AUTH_NOT_CONFIGURED"
            );
            return;
        }
        final String serverClientId = getContext().getString(clientIdResource);

        GetGoogleIdOption googleIdOption = new GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(serverClientId)
            .setAutoSelectEnabled(false)
            .build();

        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build();

        CredentialManager credentialManager = CredentialManager.create(getActivity());
        CancellationSignal cancellationSignal = new CancellationSignal();
        Executor mainExecutor = ContextCompat.getMainExecutor(getContext());

        credentialManager.getCredentialAsync(
            getActivity(),
            request,
            cancellationSignal,
            mainExecutor,
            new androidx.credentials.CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    authenticateWithFirebase(response.getCredential(), call);
                }

                @Override
                public void onError(@NonNull GetCredentialException error) {
                    if (error instanceof GetCredentialCancellationException) {
                        call.reject("Login Google cancelado.", "GOOGLE_AUTH_CANCELLED");
                    } else {
                        call.reject("Não foi possível abrir o login Google.", "GOOGLE_AUTH_FAILED", error);
                    }
                }
            }
        );
    }

    private void authenticateWithFirebase(Credential credential, PluginCall call) {
        if (!(credential instanceof CustomCredential)
            || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
            call.reject("Credencial Google inválida.", "GOOGLE_AUTH_INVALID_CREDENTIAL");
            return;
        }

        try {
            GoogleIdTokenCredential googleCredential = GoogleIdTokenCredential.createFrom(credential.getData());
            AuthCredential firebaseCredential = GoogleAuthProvider.getCredential(googleCredential.getIdToken(), null);

            FirebaseAuth.getInstance()
                .signInWithCredential(firebaseCredential)
                .addOnCompleteListener(getActivity(), task -> {
                    if (!task.isSuccessful()) {
                        call.reject("O Firebase recusou o login Google.", "GOOGLE_AUTH_FIREBASE_FAILED", task.getException());
                        return;
                    }

                    FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
                    if (user == null) {
                        call.reject("Usuário Google não encontrado após o login.", "GOOGLE_AUTH_USER_MISSING");
                        return;
                    }

                    user.getIdToken(true).addOnCompleteListener(tokenTask -> {
                        if (!tokenTask.isSuccessful() || tokenTask.getResult() == null) {
                            call.reject("Não foi possível gerar o token do login Google.", "GOOGLE_AUTH_TOKEN_FAILED", tokenTask.getException());
                            return;
                        }

                        JSObject result = new JSObject();
                        result.put("idToken", tokenTask.getResult().getToken());
                        call.resolve(result);
                    });
                });
        } catch (Exception error) {
            call.reject("Não foi possível interpretar a credencial Google.", "GOOGLE_AUTH_INVALID_CREDENTIAL", error);
        }
    }
}
