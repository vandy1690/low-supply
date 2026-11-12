// The supply library. Shared by the server and both apps, so a name is spelled once.
// Generic names and generic icons only: no brand names, no brand images.
// `say` is what read aloud speaks when the label would sound wrong out loud.

export const BUILT_IN = [
  { id: 'sensor', label: 'Sensor', icon: 'circle-dot' },
  { id: 'pump', label: 'Pump / Pod', icon: 'device-mobile', say: 'Pump or pod' },
  { id: 'insulin', label: 'Insulin', icon: 'vaccine-bottle' },
  { id: 'pen', label: 'Insulin pen', icon: 'vaccine' },
  { id: 'needles', label: 'Pen needles', icon: 'needle' },
  { id: 'meter', label: 'Glucose meter', icon: 'device-heart-monitor' },
  // No strip icon exists in the open set, so this one is the placeholder shape.
  { id: 'strips', label: 'Test strips', icon: 'rectangle-vertical' },
  // Also a placeholder shape, turned on its side so it does not read as the other strips.
  { id: 'ketone', label: 'Ketone test strips', icon: 'rectangle' },
  { id: 'glucagon', label: 'Glucagon', icon: 'first-aid-kit' },
  // The generic name for the nose spray kind. No brand names in the built in list.
  { id: 'nasal', label: 'Nasal glucagon', icon: 'spray' }
];

// What a parent can pick from for a custom supply. `name` is read to screen readers.
export const ICON_CHOICES = [
  { icon: 'box', name: 'Box' },
  { icon: 'package', name: 'Package' },
  { icon: 'bandage', name: 'Bandage' },
  { icon: 'first-aid-kit', name: 'First aid kit' },
  { icon: 'pill', name: 'Pill' },
  { icon: 'bottle', name: 'Bottle' },
  { icon: 'battery-2', name: 'Battery' },
  { icon: 'plug', name: 'Plug' },
  { icon: 'scissors', name: 'Scissors' },
  { icon: 'candy', name: 'Candy' },
  { icon: 'apple', name: 'Apple' },
  { icon: 'glass-full', name: 'Juice glass' },
  { icon: 'milk', name: 'Milk' },
  { icon: 'cookie', name: 'Cookie' },
  { icon: 'backpack', name: 'Backpack' },
  { icon: 'droplet', name: 'Droplet' },
  { icon: 'heart', name: 'Heart' },
  { icon: 'star', name: 'Star' },
  { icon: 'clipboard', name: 'Clipboard' },
  { icon: 'hand-sanitizer', name: 'Pump bottle' },
  { icon: 'thermometer', name: 'Thermometer' },
  { icon: 'flask', name: 'Flask' },
  { icon: 'sticker', name: 'Sticker' },
  { icon: 'square', name: 'Square' },
  { icon: 'circle', name: 'Circle' }
];

export const LEVELS = { low: 'Running low', out: 'I am out' };

export const CHECK_IN_DAYS = [0, 1, 2, 3, 5, 7, 10, 14, 30];
export const REMINDER_HOURS = [1, 2, 4, 8, 12, 24];
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
