const express = require("express");
const User = require("../Models/User");
const Tokens = require("../Models/Token");
const sendMail = require("../Services/Mail-Service");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const limiter = require("../Services/Rate-Limiter");
const authRouter = express.Router();

authRouter.post("/login", limiter, async (req, res, next) => {
  try {
    console.log("Received login request", req.body);
    const user = req.body;
    let error_message = "";
    const userFound = await User.findOne({ username: user.username });
    if (!userFound || user.password !== userFound.password) {
      error_message = "Wrong username and/or password";
    }

    if (error_message !== "") {
      return res.status(400).json({
        error: {
          error_message,
          isAuth: false,
        },
      });
    }

    req.session.isLoggedIn = true;
    req.session.username = user.username;
    res.status(200).json({
      message: {
        text: "Success",
        isAuth: true,
        username: user.username,
      },
    });
  } catch (e) {
    return res.status(500).json({
      error: {
        error_message: "Internal Server Error",
      },
    });
  }
});

authRouter.post("/signup", async (req, res, next) => {
  const user = req.body;
  const formErrors = { usernameError: "", passwordError: "" };

  if (user.username.trim().length === 0) {
    formErrors.usernameError = "Username cannot be empty";
  }
  if (user.username.trim().length < 3) {
    formErrors.usernameError = "Username should be at least 3 characters";
  }

  if (/[^-_.a-zA-Z]/.test(user.username)) {
    formErrors.usernameError =
      "No special characters except hyphens, underscores and periods.";
  }

  if (user.password.length < 6) {
    formErrors.passwordError = "Password must be at least 6 characters";
  }
  if (user.password.length === 0) {
    formErrors.passwordError = "Password cannot be empty";
  }

  const takenUsername = await User.findOne({ username: user.username });

  if (takenUsername) {
    formErrors.usernameError = "Username already taken";
  }

  if (formErrors.usernameError || formErrors.passwordError) {
    console.log(formErrors);

    return res.status(400).json({
      error: {
        usernameError: formErrors.usernameError,
        passwordError: formErrors.passwordError,
      },
    });
  }
  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(user.password, salt);

  const newUser = await new User({
    email: user.email,
    username: user.username,
    password: hashedPassword,
  }).save();

  const token = await new Tokens({
    userId: newUser._id,
    token: crypto.randomBytes(32).toString("hex"),
  }).save();

  const url = `${process.env.BASE_URL}users/${newUser._id}/verify/${token.token}`;
  await sendMail(user.email, "Verify Email", url);

  res.status(201).json({
    message: "Verification Link is sent to your inbox",
  });
});

authRouter.post("/logout", (req, res, next) => {
  req.session.destroy((e) => {
    console.log(e);
  });

  res.json({ message: "Logged out" });
});

authRouter.get(
  `${process.env.BASE_URL}users/:user_id/verify/:token`,
  async (req, res, next) => {
    try {
      const user = await User.findOne({ _id: req.params.user_id });
      if (!user) {
        return res.status(400).json({
          error: "User not found",
        });
      }
      const token = Tokens.findOne({
        userId: req.params.user._id,
        token: req.params.token,
      });
      if (!token) {
        return res.status(400).json({ error: "Invalid Token/Link" });
      }
      await User.updateOne({ _id: user._id, verified: true });
      await token.remove();

      res.status(201).json({
        message: "Email Verified",
      });
    } catch (e) {
      res.status(500).json({ error: "Internal Server Error" });
      console.log(e);
    }
  }
);

module.exports = authRouter;
