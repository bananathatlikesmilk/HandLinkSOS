package com.handlink.sos;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "HandLinkPhone")
public class HandLinkPhonePlugin extends Plugin {
    @PluginMethod
    public void openDialer(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:911"));
                getActivity().startActivity(intent);
                call.resolve();
            } catch (ActivityNotFoundException | SecurityException exception) {
                call.reject("Could not open the phone dialer. Open your Phone app yourself.");
            }
        });
    }
}
