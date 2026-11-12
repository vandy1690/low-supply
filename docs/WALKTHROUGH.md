# Low Supply, step by step

Low Supply lets a child with type 1 diabetes tell both parents when a supply is running
low or has run out. One tap from the child, a notification to each parent, and a note back
to the child once it is ordered.

There are no accounts and no real names. People are nicknames, and each device joins the
family with a one time code.

![A child's phone and a parent's phone side by side](demo/low-supply-demo.gif)

The screens below were captured from the app with sample nicknames (Dad, Mom, Kiddo).
The full video is at [demo/low-supply-demo.mp4](demo/low-supply-demo.mp4).

## Part 1: A parent sets up the family

### 1. Open Low Supply

On an iPhone, add Low Supply to the Home Screen first and open it from there.
Notifications only work from the Home Screen copy. Then tap **Set up a new family**.

<img src="screenshots/01-welcome.png" alt="Welcome screen with Set up a new family and Link this device to a family" width="280">

### 2. Type your nickname

A nickname such as Dad is all the app asks for.

<img src="screenshots/02-new-family.png" alt="New family form with the nickname Dad typed in" width="280">

### 3. Turn on notifications

This is how a parent hears that a supply is running low. Each parent turns it on once, on
their own phone.

<img src="screenshots/03-notifications.png" alt="Step 2 of 7, Turn on notifications" width="280">

### 4. Invite the other parent

Type their nickname and the app makes a code. They scan it with their phone camera, or
type it in. Both parents get every alert, and either one can mark a request ordered. This
step can be skipped and done later in Settings.

<img src="screenshots/04-invite-other-parent.png" alt="A QR code and a typed code for the other parent" width="280">

### 5. Add your child

A nickname only. More children can be added later.

<img src="screenshots/05-add-child.png" alt="Add your child form with the nickname Kiddo" width="280">

### 6. Choose what your child can ask for

Pick from the built in list. Each choice becomes one big button on the child's phone.
Custom supplies, such as juice boxes, are added in Settings.

<img src="screenshots/06-choose-supplies.png" alt="A checklist of supplies with four chosen" width="280">

### 7. Set check ins

For each supply, choose how often the app should ask the child whether they are running
low. Quiet hours and read aloud are set here too.

<img src="screenshots/07-check-ins.png" alt="Check in schedule for each supply" width="280">

### 8. Link your child's device

The last step shows a code for the child's phone. It works once, for that child only, and
stops working after 30 minutes.

<img src="screenshots/08-link-child-device.png" alt="A QR code and a typed code for the child's device" width="280">

## Part 2: The child's phone

### 9. Link with the code

On the child's phone, open Low Supply, tap **Link this device to a family**, and scan or
type the code.

<img src="screenshots/09-child-types-code.png" alt="The child's phone with the code typed in" width="280">

### 10. Choose whether to get notes back

The child is asked once whether they want a note when a parent orders their supplies.

<img src="screenshots/10-child-notes-from-parents.png" alt="Two large buttons: Yes, turn on and Not now" width="280">

### 11. The child's home screen

One large button for each supply, filling the screen. The speaker button turns read aloud
on or off.

<img src="screenshots/11-child-home.png" alt="Four large supply buttons: Sensor, Pump or Pod, Insulin, Test strips" width="280">

## Part 3: Asking and ordering

### 12. The child taps a supply

Two choices: **Running low** or **I am out**.

<img src="screenshots/12-child-supply.png" alt="Sensor screen with Running low and I am out" width="280">

### 13. The request is sent

The button changes to show the parents know. Tapping it again cancels the request. Tapping
the other button updates the same request, so parents never see duplicates.

<img src="screenshots/13-child-asked.png" alt="Running low now reads Cancel running low, your parents know" width="280">

### 14. Both parents see it

Each parent gets a notification, and the request sits on a list both of them share.

<img src="screenshots/14-parent-request.png" alt="A parent's request list showing Sensor, for Kiddo, Running low" width="280">

### 15. A parent marks it ordered

Either parent taps **Mark ordered**. The request clears for both parents.

<img src="screenshots/15-parent-marked-ordered.png" alt="Marked ordered, Kiddo was told" width="280">

### 16. The child hears back

The child's phone shows who ordered it.

<img src="screenshots/16-child-told-it-is-ordered.png" alt="A note on the child's phone: Mom ordered your Sensor" width="280">

## Part 4: Looking after it

### 17. Settings

Add children, parents and custom supplies. Change reminders. See every linked device, make
a new code for a replaced phone, and remove an old one.

<img src="screenshots/17-settings.png" alt="Settings with Children and Parents sections" width="280">

### 18. Reset

If a device gets stuck, **Reset this device** unlinks it and clears what Low Supply saved
on it. The rest of the family is not touched. A parent can also delete the whole family
in Settings and start over.

<img src="screenshots/18-reset.png" alt="Reset this device screen" width="280">

## Remaking these images

`node scripts/demo.mjs` rebuilds every screenshot and the video from the running app, so
they stay in step with the code. It needs ffmpeg for the video.
