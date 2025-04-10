require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const otpGenerator = require('otp-generator');
const fs = require('fs');
const path = require('path');

const User = require('./models/User');
const Team = require('./models/Team');

const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: 'vit_secret_key',
    resave: false,
    saveUninitialized: false
}));

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB connected"))
    .catch(err => console.log(err));

// === Landing Page ===
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === Contact Form - NodeMailer ===
app.post('/send-message', (req, res) => {
    const { name, email, message } = req.body;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    const mailOptions = {
        from: `"Hackathon Contact Form" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER,
        subject: 'New Contact Form Submission',
        html: `
            <h3>New Contact Submission</h3>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Message:</strong></p>
            <p>${message}</p>
        `
    };

    transporter.sendMail(mailOptions, (err) => {
        if (err) {
            console.error("Mail error:", err);
            return res.send("❌ Failed to send message. Please try again.");
        }
        res.send("✅ Message sent successfully!");
    });
});

// === Signup ===
app.get('/signup', (req, res) => {
    res.render('signup', { error: null });
});

app.post('/signup', async (req, res) => {
    const { name, regno, phone, email, hostelBlock, gender, password } = req.body;

    const emailRegex = /^[a-zA-Z0-9._%+-]+@(vitstudent\.ac\.in|vit\.ac\.in)$/;
    if (!emailRegex.test(email)) {
        return res.render('signup', { error: 'Only VIT emails allowed' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.render('signup', { error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = otpGenerator.generate(6, { digits: true });

    req.session.userData = {
        name, regno, phone, email, hostelBlock, gender,
        password: hashedPassword, otp
    };

    const templatePath = path.join(__dirname, 'views', 'otp-template.html');
    const emailTemplate = fs.readFileSync(templatePath, 'utf-8').replace('{{OTP}}', otp);

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    const mailOptions = {
        from: `"Standards Hackathon" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Your Standards Hackathon OTP',
        html: emailTemplate
    };

    transporter.sendMail(mailOptions, (err) => {
        if (err) {
            console.error(err);
            return res.render('signup', { error: 'Failed to send OTP. Try again.' });
        }
        console.log("OTP sent:", otp);
        res.redirect('/verify-otp');
    });
});

// === OTP ===
app.get('/verify-otp', (req, res) => {
    res.render('otp', { error: null });
});

app.post('/verify-otp', async (req, res) => {
    const { enteredOtp } = req.body;
    const { otp, ...userData } = req.session.userData;

    if (enteredOtp === otp) {
        const newUser = new User({ ...userData, verified: true });
        await newUser.save();
        res.redirect('/login');
    } else {
        res.render('otp', { error: 'Invalid OTP' });
    }
});

// === Login ===
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !user.verified) {
        return res.render('login', { error: 'User not found or not verified' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.render('login', { error: 'Invalid credentials' });

    req.session.user = user;

    if (user.email === 'standardsclub@vit.ac.in') {
        return res.redirect('/admin');
    }

    res.redirect('/dashboard');
});

// === Dashboard ===
app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const user = await User.findById(req.session.user._id)
        .populate({
            path: 'team',
            populate: { path: 'members', model: 'User' }
        });

    res.render('dashboard', { user, query: req.query });
});

// === Logout ===
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.log("Logout Error:", err);
            return res.redirect('/dashboard');
        }

        res.clearCookie('connect.sid', { path: '/' }); // 👈 Clears session cookie
        res.redirect('/login');
    });
});


// === Create Team ===
app.post('/create-team', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const leader = await User.findById(req.session.user._id);
    if (leader.team) return res.send("❌ You are already in a team.");

    const { teamName, members, track, idea } = req.body;

    if (!teamName || !Array.isArray(members) || members.length < 2 || members.length > 4) {
        return res.send("❌ Provide a team name and 2–4 additional members.");
    }

    const allRegs = [leader.regno, ...members.map(r => r.trim().toUpperCase())];
    const uniqueRegs = [...new Set(allRegs)];
    const users = await User.find({ regno: { $in: uniqueRegs }, verified: true });

    if (users.length !== uniqueRegs.length) {
        return res.send("❌ One or more reg numbers not found or not verified.");
    }

    const alreadyInTeam = users.find(u => u.team);
    if (alreadyInTeam) {
        return res.send(`❌ ${alreadyInTeam.name} (${alreadyInTeam.regno}) is already in a team.`);
    }

    const team = new Team({
        name: teamName,
        leader: leader._id,
        members: users.map(u => u._id),
        track,
        idea,
        status: 'Pending'
    });

    await team.save();
    await User.updateMany({ _id: { $in: users.map(u => u._id) } }, { $set: { team: team._id } });

    res.redirect('/dashboard');
});

// === Final Project Submission ===
app.post('/submit-project', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const user = await User.findById(req.session.user._id);
    if (!user.team) return res.send("❌ You are not in a team.");

    const team = await Team.findById(user.team);
    if (!team) return res.send("❌ Team not found.");

    const { github, linkedin, document } = req.body;

    team.github = github;
    team.linkedin = linkedin;
    team.document = document; // Google Sheets link
    await team.save();

    res.redirect('/dashboard?submitted=true');
});

// === Admin Dashboard ===
app.get('/admin', async (req, res) => {
    if (!req.session.user || req.session.user.email !== 'standardsclub@vit.ac.in') {
        return res.status(403).send('Access denied.');
    }

    const users = await User.find().populate('team');
    const teams = await Team.find().populate('leader').populate('members');

    res.render('admin', { user: req.session.user, users, teams });
});

app.post('/team/:id/approve', async (req, res) => {
    if (!req.session.user || req.session.user.email !== 'standardsclub@vit.ac.in') {
        return res.status(403).send('Unauthorized');
    }

    await Team.findByIdAndUpdate(req.params.id, { status: 'Approved' });
    res.redirect('/admin');
});

app.post('/team/:id/reject', async (req, res) => {
    if (!req.session.user || req.session.user.email !== 'standardsclub@vit.ac.in') {
        return res.status(403).send('Unauthorized');
    }

    await Team.findByIdAndUpdate(req.params.id, { status: 'Rejected' });
    res.redirect('/admin');
});


// 404 - Not Found
app.use((req, res, next) => {
    res.status(404).render('404');
});

// 503 - Maintenance or fallback (manually trigger this if needed)
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(503).render('503');
});


// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
