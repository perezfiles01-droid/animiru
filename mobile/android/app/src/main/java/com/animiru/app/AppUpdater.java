package com.animiru.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;

/**
 * Downloads an update and hands it to the system installer.
 *
 * The app's Update screen used to render a plain link to the APK. A WebView
 * does nothing at all with such a link: it has no download handling unless a
 * DownloadListener is set, and the link carried target="_blank", which a
 * WebView without multiple-window support drops silently. Tapping it could
 * not have worked, which is exactly what it did.
 *
 * The download goes through DownloadManager rather than being fetched by the
 * app: it survives the app being backgrounded, retries across a network
 * change, and shows real progress in the notification shade without this
 * class drawing any of it.
 *
 * What this cannot do is restart the app afterwards. Android kills a process
 * when its package is replaced, and only a device owner may install silently.
 * The honest end of the flow is the system installer's own Install and Open.
 */
public class AppUpdater {

    private static final String MIME_APK = "application/vnd.android.package-archive";

    private final Activity activity;

    /** The download in flight, or -1. Only one update at a time is useful. */
    private long downloadId = -1;
    private BroadcastReceiver completionReceiver;

    public AppUpdater(Activity activity) {
        this.activity = activity;
    }

    /**
     * Starts downloading an update.
     *
     * @param url         the APK
     * @param userAgent   what the WebView would have sent
     * @param contentDisposition may carry the filename the server suggested
     */
    public void download(String url, String userAgent, String contentDisposition) {
        if (downloadId != -1) {
            toast("Already downloading the update");
            return;
        }

        final String fileName = fileNameFor(url, contentDisposition);

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setMimeType(MIME_APK);
        request.setTitle("Animiru update");
        request.setDescription(fileName);
        request.setNotificationVisibility(
                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        // The app's own external files directory needs no storage permission
        // at any API level, and is the directory the FileProvider exposes.
        request.setDestinationInExternalFilesDir(
                activity, Environment.DIRECTORY_DOWNLOADS, fileName);

        if (userAgent != null && !userAgent.isEmpty()) {
            request.addRequestHeader("User-Agent", userAgent);
        }

        DownloadManager manager =
                (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            toast("This device has no download manager");
            return;
        }

        // A file left from a previous update would otherwise accumulate, and
        // DownloadManager appends "-1" rather than replacing it.
        File existing = new File(
                activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName);
        if (existing.exists() && !existing.delete()) {
            // Not fatal: the download simply lands under a different name.
            toast("Could not clear the previous download");
        }

        registerCompletionReceiver();
        downloadId = manager.enqueue(request);
        toast("Downloading update...");
    }

    /** Frees the receiver. Called when the activity goes away. */
    public void release() {
        if (completionReceiver != null) {
            try {
                activity.unregisterReceiver(completionReceiver);
            } catch (IllegalArgumentException ignored) {
                // Already unregistered; nothing to undo.
            }
            completionReceiver = null;
        }
    }

    private void registerCompletionReceiver() {
        if (completionReceiver != null) return;

        completionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                // The shade reports every download on the device, not only ours.
                if (id != downloadId) return;

                downloadId = -1;
                onDownloadFinished(id);
            }
        };

        // Exported: DownloadManager is a system component outside this app,
        // and on API 33+ a receiver without this flag never fires.
        ContextCompat.registerReceiver(
                activity,
                completionReceiver,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                ContextCompat.RECEIVER_EXPORTED);
    }

    private void onDownloadFinished(long id) {
        DownloadManager manager =
                (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return;

        DownloadManager.Query query = new DownloadManager.Query().setFilterById(id);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                toast("The update download disappeared");
                return;
            }

            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                toast("The update failed to download (" + reason + ")");
                return;
            }

            String localUri = cursor.getString(
                    cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
            install(Uri.parse(localUri));
        } catch (IllegalArgumentException e) {
            toast("Could not read the download: " + e.getMessage());
        }
    }

    /**
     * Opens the system installer for a downloaded APK.
     *
     * On Android 8 and above the app must hold "install unknown apps" before
     * the installer will open. When it does not, the user is sent to that
     * settings screen rather than being shown nothing - which is the failure
     * mode this whole class exists to remove.
     */
    private void install(Uri localUri) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !activity.getPackageManager().canRequestPackageInstalls()) {
            toast("Allow Animiru to install apps, then tap the download again");
            activity.startActivity(new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())));
            return;
        }

        Uri apk = shareableUri(localUri);
        if (apk == null) {
            toast("Could not open the downloaded update");
            return;
        }

        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(apk, MIME_APK);
        // The installer is another process; without this it cannot read the
        // content:// URI it was just handed.
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            activity.startActivity(install);
        } catch (Exception e) {
            toast("No installer available on this device");
        }
    }

    /**
     * Turns DownloadManager's local URI into one another process may read.
     *
     * Since Android 7 a file:// URI crossing a process boundary throws
     * FileUriExposedException, so the file is republished through the
     * FileProvider declared in the manifest.
     */
    private Uri shareableUri(Uri localUri) {
        if (localUri == null) return null;

        if (ContentResolver.SCHEME_CONTENT.equals(localUri.getScheme())) {
            return localUri;
        }

        String path = localUri.getPath();
        if (path == null) return null;

        try {
            return FileProvider.getUriForFile(
                    activity,
                    activity.getPackageName() + ".fileprovider",
                    new File(path));
        } catch (IllegalArgumentException e) {
            // The file is outside every path the provider publishes.
            return null;
        }
    }

    /**
     * A filename for the download.
     *
     * Taken from the URL rather than trusted from the server: a
     * Content-Disposition naming "../../something" would otherwise be written
     * outside the directory the provider is scoped to.
     */
    static String fileNameFor(String url, String contentDisposition) {
        String candidate = null;

        if (contentDisposition != null) {
            int at = contentDisposition.indexOf("filename=");
            if (at != -1) {
                candidate = contentDisposition.substring(at + 9).replace("\"", "").trim();
            }
        }

        if (candidate == null || candidate.isEmpty()) {
            // Parsed by hand rather than with Uri so this method stays plain
            // Java and can be tested off-device - it is the one guarding
            // against a filename that escapes its directory.
            String path = url == null ? "" : url;
            int query = path.indexOf('?');
            if (query != -1) path = path.substring(0, query);
            int fragment = path.indexOf('#');
            if (fragment != -1) path = path.substring(0, fragment);
            int lastSlash = path.lastIndexOf('/');
            candidate = lastSlash == -1 ? path : path.substring(lastSlash + 1);
        }

        // Whatever it came from, keep only a bare filename.
        candidate = candidate.replace("\\", "/");
        int slash = candidate.lastIndexOf('/');
        if (slash != -1) candidate = candidate.substring(slash + 1);
        candidate = candidate.replaceAll("[^A-Za-z0-9._-]", "");

        if (candidate.isEmpty() || !candidate.toLowerCase().endsWith(".apk")) {
            candidate = "animiru-update.apk";
        }
        return candidate;
    }

    private void toast(String message) {
        activity.runOnUiThread(() ->
                Toast.makeText(activity, message, Toast.LENGTH_LONG).show());
    }
}
