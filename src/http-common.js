import axios from "axios";

export default axios.create({
  baseURL: "http://192.168.0.102:3000",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
  }
});
