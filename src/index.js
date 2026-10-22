const express = require("express");


const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.send("Server is running and healthy")
})

app.get("/health" , (req,res) => {
    res.send("Server is healthy")
})

app.get("/api" , (req,res) => {

    res.send("API is working")
})


app.listen(3000 , () => {
    console.log("Server is running on port 3000")
})