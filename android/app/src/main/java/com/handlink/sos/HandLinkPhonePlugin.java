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
        openNumber(call, "911");
    }

    @PluginMethod
    public void openDialerWithNumber(PluginCall call) {
        String number = call.getString("number");
        if (number == null || !number.matches("\\+?[0-9]{3,15}")) {
            call.reject("Invalid SOS phone number.");
            return;
        }
        openNumber(call, number);
    }

    private void openNumber(PluginCall call, String number) {
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null));
                getActivity().startActivity(intent);
                call.resolve();
            } catch (ActivityNotFoundException | SecurityException exception) {
                call.reject("Could not open the phone dialer. Open your Phone app yourself.");
            }
        });
    }
}
