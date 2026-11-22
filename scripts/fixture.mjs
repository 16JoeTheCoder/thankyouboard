// Generated only by the isolated Wrangler demo. Never imported by application code.
const given = [
  'Ada',
  'Alex',
  'Amal',
  'Anika',
  'Arun',
  'Ava',
  'Ben',
  'Bianca',
  'Cara',
  'Carmen',
  'Cleo',
  'Dara',
  'David',
  'Eden',
  'Eli',
  'Emilia',
  'Felix',
  'Fern',
  'Grace',
  'Hana',
  'Hazel',
  'Ira',
  'Ivy',
  'Jamie',
  'Jess',
  'Jules',
  'Kai',
  'Kiran',
  'Lena',
  'Leo',
  'Maya',
  'Milo',
  'Nia',
  'Noah',
  'Nora',
  'Owen',
  'Priya',
  'Remy',
  'Rowan',
  'Sam',
  'Zoe',
]
const family = [
  'Chen',
  'Rivera',
  'Patel',
  'Reed',
  'Parker',
  'Santos',
  'Tan',
  'Martin',
  'Brooks',
  'Cruz',
  'Reyes',
  'Liu',
  'Baker',
  'Singh',
  'Wood',
  'James',
  'Wong',
  'Gale',
  'Kim',
  'Bell',
  'Scott',
  'Ford',
  'Hill',
  'Lee',
  'Wells',
  'Stone',
  'Green',
  'Hart',
  'Moon',
  'Banks',
  'Sato',
  'Cole',
  'Shah',
  'White',
  'Khan',
  'West',
  'King',
  'Black',
  'Chan',
  'Davis',
  'Hall',
]
const lines = [
  'You wrote “try one more time” in the margin. I still think of that when I get stuck.',
  'Thank you for waiting while I found the words. That small kindness changed my whole afternoon.',
  'I was so nervous to raise my hand. You made the room feel like a place where my question belonged.',
  'The diagram you drew on the board finally made it click. I drew it for my little brother that evening.',
  'On the rainy field trip, you turned the bus ride into my favourite part of the day.',
  'You noticed my first sketch before I thought there was anything in it worth noticing.',
  'I still have the card you left on my desk after the recital. Thank you for listening.',
  'When our experiment failed, you asked what surprised us. Now I keep a page for surprises.',
  'Your feedback helped me put my own ending back into the story. It sounds like me again.',
  'Thank you for the quiet seat by the window on a difficult morning. I remember.',
  'You saved the last five minutes for our questions, even the very small ones.',
  'Every time I use the library I remember how you helped me find that first book.',
]
export function fixture() {
  const notes = []
  for (const [i, first] of given.entries()) {
    const count = i === 0 ? 55 : i === 1 ? 3 : i < 15 ? 12 : 11
    for (let j = 0; j < count; j++) {
      let text = lines[(j + i) % lines.length]
      if (i === 0 && j === 0)
        text =
          '謝謝老師，您讓我勇於發問。\nThank you for making room for every voice. 🌷'
      if (i === 0 && j === 1)
        text = Array.from(
          { length: 14 },
          (_, k) => lines[k % lines.length],
        ).join('\n\n')
      notes.push({
        id: 'demo-' + String(notes.length + 1).padStart(3, '0'),
        teacher: first + ' ' + family[i],
        text,
      })
    }
  }
  return { notes }
}
