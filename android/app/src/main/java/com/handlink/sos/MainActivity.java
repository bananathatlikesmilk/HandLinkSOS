package com.handlink.sos;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HandLinkLocationPlugin.class);
        registerPlugin(HandLinkPhonePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
