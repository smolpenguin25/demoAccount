var express = require('express');
var router = express.Router();
const AccountModel = require('../models/account.model');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const {body, validationResult} = require('express-validator');

// Set storage engine
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/images');
  },
  filename: function (req, file, cb) {
    //prevent duplicate filename
    cb(null, `${Date.now()}${path.extname(file.originalname)}`);
  }
})

// Check file type
const upload = multer({
  storage: storage,
  //limit to 5MB
  limits: { fileSize: 5 * 1024 * 1024 },
  // fileFilter: function (req, file, cb) {
  //   checkFileType(file, cb);
  // }
});
//.single('image');
//middleware check JWT token
const autheticateToken = (req, res, next) => {
  const authHeader = req.header('Authorization');
  if(!authHeader){
    return res.status(401).send("Access denied");
  }
  const token = authHeader.split(' ')[1];
  if(!token){
    return res.status(401).send("Access denied");
  }
  try{
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log(decoded);
    req.account = decoded;
    next();
  }catch(err){
    res.status(400).send("Invalid token");
  }
}
/* GET users listing. */
router.get('/', async (req, res, next) => {
  var accounts = await AccountModel.find();
  await res.render("account/index", { accounts });
});

router.get('/create', async (req, res, next) => {
  await res.render("account/create");
});

router.post('/create', 
  upload.single("image"), 
  [
    body("email").notEmpty().withMessage("Email is required").isEmail().withMessage("Invalid email"),
    body("pwd").notEmpty().withMessage("Password is required").isLength({min: 3}).withMessage("Password must be at least 3 characters"),
    body("confirmPassword").custom((value, {req}) => value === req.body.pwd).withMessage("Passwords do not match"),
    body("phone").notEmpty().withMessage("Phone is required").isMobilePhone().withMessage("Invalid phone number"),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    console.log(errors);
    if(!errors.isEmpty()){
      return res.render("account/create", { errors: errors.array(), email: req.body.email, phone: req.body.phone, fullname: req.body.fullname });
    }
    try{
      const {fullname, email, pwd, phone, role} = req.body;
      image = req.file ? req.file.filename : "";
      const active = false; //default active

      const account = new AccountModel({ fullname, email, pwd, phone, role, image, active });

      await account.save();
      await res.redirect("/acc");
    }catch(error){
      res.send(error);
      await res.render("account/create");
    }  
});

router.get('/delete/:id', async (req, res, next) => {
  //delete image store in public/images
  var account = await AccountModel.findById(req.params.id);
  var fs = require('fs');
  if(account.image != ""){
    fs.unlinkSync(`public/images/${account.image}`);
  }

  await AccountModel.findByIdAndDelete(req.params.id);
  await res.redirect("/acc");
}
);

router.get('/edit/:id', async (req, res, next) => {
  var account = await AccountModel.findById(req.params.id);
  await res.render("account/edit", { account });
});

router.post('/edit/:id', upload.single("image"),
[
  body("email").notEmpty().withMessage("Email is required").isEmail().withMessage("Invalid email"),
  body("pwd").notEmpty().withMessage("Password is required").isLength({min: 3}).withMessage("Password must be at least 3 characters"),
  body("confirmPassword").custom((value, {req}) => {
    if(value !== req.body.pwd){
      throw new Error("Passwords do not match");
    }
    return true;
  }),
  body("phone").notEmpty().withMessage("Phone is required").isMobilePhone().withMessage("Invalid phone number"),
], 
async (req, res, next) => {
  const errors = validationResult(req);
    console.log(errors);
    if(!errors.isEmpty()){
      var account = await AccountModel.findById(req.params.id);
      return res.render("account/edit", { errors: errors.array(), email: req.body.email, phone: req.body.phone, fullname: req.body.fullname, account });
    }
  try{
    const {email, pwd, phone, role} = req.body;
    const image = req.file ? req.file.filename : "";
    await AccountModel.findByIdAndUpdate(req.params.id, { email, pwd, phone, role, image });
    await res.redirect("/acc");
  }catch(error){
    res.send(error);
    await res.render("account/edit");
  }
});

router.get('/register', async (req, res, next) => {
  await res.render("account/register");
});

router.post('/register', 
  [
    body("email").notEmpty().withMessage("Email is required").isEmail().withMessage("Invalid email"),
    body("pwd").notEmpty().withMessage("Password is required").isLength({min: 3}).withMessage("Password must be at least 3 characters"),
    body("confirmPassword").custom((value, {req}) => {
      if(value !== req.body.pwd){
        throw new Error("Passwords do not match");
      }
      return true;
    }),
    body("phone").notEmpty().withMessage("Phone is required").isMobilePhone().withMessage("Invalid phone number"),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    console.log(errors.errors);
    if(!errors.isEmpty()){
      return res.render("account/register", { errors: errors.array(), email: req.body.email, phone: req.body.phone, fullname: req.body.fullname });
    }
  const {fullname, email, pwd, phone} = req.body;
  try{
    let account = await AccountModel.findOne({email});
    if(account){
      return res.status(400).send({message: "Email already exists"});
    }

    const verifyToken = jwt.sign({email}, process.env.JWT_SECRET, {
      expiresIn: '1h'
    });

    account = new AccountModel({
      fullname, 
      email, 
      pwd, 
      phone,
      role: "user",
      active: false,
      image: "",
      verify_token: verifyToken,
    });
    await account.save();

    //send activation email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const link = `${req.protocol}://${req.get('host')}/acc/verify/${verifyToken}`;
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Account Activation',
      html: `<h2>Account Activation</h2><p>Click this link to activate your account:</p><a href="${link}">Activate</a>`,
    });

    res.status(200).send({message: "Account created. Please check your email to activate your account."});

  }catch(err){
    res.status(500).send({message: "internal server error"});
  }
})

router.get('/login', async (req, res, next) => {
  await res.render("account/login");
});

router.post('/login',
  [
    body("email").notEmpty().withMessage("Email is required").isEmail().withMessage("Invalid email"),
    body("pwd").notEmpty().withMessage("Password is required").isLength({min: 3}).withMessage("Password must be at least 3 characters"),
    // body("confirmPassword").custom((value, {req}) => {
    //   if(value !== req.body.pwd){
    //     throw new Error("Passwords do not match");
    //   }
    //   return true;
    // }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    console.log(errors);
    if(!errors.isEmpty()){
      return res.render("account/login", { errors: errors.array(), email: req.body.email });
    }
  const {email, pwd} = req.body;
  try{
    let account = await AccountModel.findOne({email});
    //console.log(account);
    if(!account){
      return res.status(400).send({message: "Invalid email or password"});
    }

    if(!account.active){
      return res.status(400).send({message: "Account not activated"});
    }

    const isMatch = await bcrypt.compare(pwd, account.pwd);
    //console.log(pwd + account.pwd);
    //console.log(isMatch);
    if(!isMatch){
      return res.status(400).send({message: "Invalid email or password"});
    }

    const token = jwt.sign({id: account._id}, process.env.JWT_SECRET, {
      expiresIn: '1d'
    });

    res.status(200).json({message: "Login successful", token});
  }
  catch(err){
    res.status(500).send({message: err.message});
  }
});

router.get('/verify/:token', async (req, res, next) => {
  const token = req.params.token;
  try{
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const account = await AccountModel.findOne({email: decoded.email});
    if(!account){
      return res.status(400).send("Token not valid");
    }
    if(account.active){
      return res.status(400).send("Account already activated");
    }
    account.active = true;
    account.verify_token = "";
    await account.save();

    res.status(200).send("Account activated");
  }catch(err){
    res.send("Invalid token");
  }
});

router.get('/getAcc', autheticateToken, async (req, res)=>{
  try{
    const id = req.account.id;
    const accounts = await AccountModel.find().select("-pwd");
    if(!accounts){
      return res.status(400).send("No account found");
    }
    res.status(200).json({
      message: "Success",
      accounts,
    });
  }catch(err){
    console.log(err);
    res.status(500).send(err.message);
  }
  
});

module.exports = router;
