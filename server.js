const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const fs = require('fs');
const path = require('path');  // Add this line to import the path module
const { doctors } = require('./data');

const APPOINTMENTS_FILE_PATH = 'appointments.json';

const app = express();  // Create the Express app here

// Move this line here, after creating the app
app.use(express.static(path.join(__dirname, 'public')));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'your-secret-key', resave: true, saveUninitialized: true }));
app.set('view engine', 'ejs');

const WORKING_HOURS_START = 9; // 9 am
const WORKING_HOURS_END = 18; // 6 pm
const WEEKDAYS = [1, 2, 3, 4, 5]; // Monday to Friday
const WEEKENDS = [0, 6]; //

let usersData = loadUserData(); // Load existing user data
let appointmentsData = loadAppointmentsData(); // Initialize appointments data
let doctorAvailability = initializeDoctorAvailability();


// Initialize appointments data with an empty object if it doesn't exist
if (!appointmentsData.appointmentsByTime) {
  appointmentsData.appointmentsByTime = {};
}

function getAppointmentsForDoctor(doctorId) {
  return appointmentsData.appointments.filter(appointment => appointment.doctorId === doctorId);
}
function markHourAvailable(doctorId, hour, isWeekend) {
  const availability = doctorAvailability[doctorId];

  if (availability) {
    availability[isWeekend ? 'weekends' : 'weekdays'][hour] = true;
  }
}


function addAppointmentToData(doctorId, appointmentDateTime, patientName) {
  const formattedDate = appointmentDateTime.toISOString().split('T')[0];
  const formattedTime = appointmentDateTime.toTimeString().split(' ')[0];

  const appointment = { doctorId, patientName, appointmentTime: `${formattedDate} ${formattedTime}` };

  // Update the data to mark this time slot as booked for the doctor
  if (!appointmentsData.appointments) {
    appointmentsData.appointments = [];
  }
  appointmentsData.appointments.push(appointment);
  saveAppointmentsData();
}


function isAppointmentTimeAvailable(doctorId, selectedDateTime) {
  const formattedDateTime = selectedDateTime.toISOString();
  return !appointmentsData.appointments.some(appointment => {
    return appointment.doctorId === doctorId && appointment.appointmentTime === formattedDateTime;
  });
}




function initializeDoctorAvailability() {
  const availability = {};

  doctors.forEach((doctor) => {
    availability[doctor.id] = {
      weekdays: Array(24).fill(true), // Assume doctors are available all day on weekdays initially
      weekends: Array(24).fill(true), // Assume doctors are available all day on weekends initially
    };
  });

  console.log('Doctor Availability:', availability);

  return availability;
}

function isDoctorAvailable(doctorId, hour, day) {
  console.log('Checking availability for doctorId:', doctorId, 'hour:', hour, 'day:', day);
  const availability = doctorAvailability[doctorId];

  if (!availability || (!availability.weekdays[hour] && WEEKDAYS.includes(day))) {
    return false; // Handle the case where doctorId is invalid or the doctor is not available on weekdays
  }

  if (!availability.weekends[hour] && WEEKENDS.includes(day)) {
    return false; // Handle the case where the doctor is not available on weekends
  }

  return true;
}

function loadAppointmentsData() {
  try {
    const data = fs.readFileSync(APPOINTMENTS_FILE_PATH);
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading appointments data:', error);
    return { appointments: [] };
  }
}

function saveAppointmentsData() {
  try {
    fs.writeFileSync(APPOINTMENTS_FILE_PATH, JSON.stringify(appointmentsData, null, 2));
  } catch (error) {
    console.error('Error saving appointments data:', error);
  }
}

function loadUserData() {
  try {
    const data = fs.readFileSync('users.json');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading user data:', error);
    return { users: [] };
  }
}

function saveUserData() {
  try {
    fs.writeFileSync('users.json', JSON.stringify(usersData, null, 2));
  } catch (error) {
    console.error('Error saving user data:', error);
  }
}

app.get('/', (req, res) => {
  const user = req.session.user;
  if (!user) {
    res.redirect('/login');
    return;
  }
  res.render('index', { doctors, user });
});

app.get('/signup', (req, res) => {
  res.render('signup');
});

app.post('/signup', (req, res) => {
  const { username, email, phone, password } = req.body;
  const hashedPassword = hashPassword(password);
  const user = { username, email, phone, hashedPassword, totalVisits: 0, appointments: [] };

  usersData.users.push(user);
  saveUserData();

  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login');
});

function verifyPassword(password, hashedPassword) {
  return password === hashedPassword;
}

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const user = usersData.users.find(u => u.username === username && verifyPassword(password, u.hashedPassword));

  if (user) {
    user.totalVisits += 1;
    req.session.user = user;
    res.redirect('/');
  } else {
    res.status(401).send('Login failed. Invalid credentials.');
  }
});

const checkLoggedIn = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/login');
};

app.get('/profile', checkLoggedIn, (req, res) => {
  const user = req.session.user;
  const userAppointments = appointmentsData.appointments.filter(appointment => appointment.patientName === user.username);
  res.render('profile', { user, appointments: userAppointments });
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.redirect('/');
    }
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

app.get('/doctor/:id', (req, res) => {
  const user = req.session.user;
  const doctorId = parseInt(req.params.id);
  const doctor = doctors.find(d => d.id === doctorId);

  if (!doctor) {
    res.status(404).send('Doctor not found.');
    return;
  }

  const bookedAppointments = getBookedAppointments(doctorId); // Get booked appointments for the doctor
  res.render('doctor', { doctor, bookedAppointments: JSON.stringify(bookedAppointments) }); // Pass bookedAppointments to the EJS template
});

app.get('/doctor/specialty/:specialty', (req, res) => {
  const user = req.session.user;
  const specialty = req.params.specialty;
  const doctor = doctors.find(d => d.specialty.toLowerCase() === specialty.toLowerCase());

  if (!doctor) {
    res.status(404).send('Doctor not found.');
    return;
  }

  res.render('doctor', { doctor });
});

app.post('/search', (req, res) => {
  const specialty = req.body.specialty;
  const doctor = doctors.find(d => d.specialty.toLowerCase() === specialty.toLowerCase());

  if (!doctor) {
    res.status(404).send('Doctor not found.');
    return;
  }

  res.render('doctor', { doctor });
});

// ... other imports and code ...
function markHourUnavailable(doctorId, hour, isWeekend) {
  const availability = doctorAvailability[doctorId];

  if (availability) {
    if (isWeekend) {
      availability.weekends[hour] = false;
    } else {
      availability.weekdays[hour] = false;
    }
  }
}

app.post('/appointment', checkLoggedIn, (req, res) => {
  console.log('Request Body:', req.body);
  const user = req.session.user;
  const { doctorId, appointmentTime, appointmentDate } = req.body;

  const appointmentDateTime = new Date(`${appointmentDate}T${appointmentTime}:00`);
  const appointmentHour = appointmentDateTime.getHours();
  const appointmentDay = appointmentDateTime.getDay();
  
  const isWeekend = WEEKENDS.includes(appointmentDay);

  if (isDoctorAvailable(doctorId, appointmentHour, appointmentDay) &&
    isAppointmentTimeAvailable(doctorId, appointmentDateTime)) {
    if (appointmentHour >= WORKING_HOURS_START && appointmentHour <= WORKING_HOURS_END) {
      const appointment = { doctorId, patientName: user.username, appointmentTime: appointmentDateTime.toISOString() };

      // Update the data to mark this time slot as booked for the doctor
      addAppointmentToData(doctorId, appointmentDateTime, user.username);

      // Redirect to the appointments page after successful booking
      res.redirect('/appointments');
    } else {
      res.status(400).send('The selected appointment time is outside working hours. Please choose a different time.');
    }
  } else {
    res.status(400).send('The selected appointment time is not available. Please choose a different time.');
  }
  console.log('After appointment check');
});






app.get('/appointments', checkLoggedIn, (req, res) => {
  const user = req.session.user;
  const userAppointments = appointmentsData.appointments.filter(appointment => appointment.patientName === user.username);
  res.render('appointments', { appointments: userAppointments, user });
});

function getBookedAppointments(doctorId) {
  const doctorAppointments = appointmentsData.appointments.filter(appointment => appointment.doctorId === doctorId);
  const bookedAppointments = {};

  // Initialize availability for each hour
  for (let hour = WORKING_HOURS_START; hour <= WORKING_HOURS_END; hour++) {
    bookedAppointments[hour] = Array(7).fill(false); // 7 days in a week
  }

  // Mark booked appointments
  doctorAppointments.forEach(appointment => {
    const appointmentDate = new Date(appointment.appointmentTime);
    const appointmentHour = appointmentDate.getHours();
    const appointmentDay = appointmentDate.getDay();

    if (appointmentHour >= WORKING_HOURS_START && appointmentHour <= WORKING_HOURS_END) {
      bookedAppointments[appointmentHour][appointmentDay] = true;
    }
  });

  return bookedAppointments;
}









// Add this route to handle direct access to "/cancel/" without an appointmentId
app.get('/cancel', (req, res) => {
  res.status(400).send('Invalid request. Please provide a valid appointment ID.');
});









const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
