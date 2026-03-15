
const modal = document.getElementById("planModal")
const changeBtn = document.getElementById("changePlanBtn")
const closeBtn = document.getElementById("closeModal")
const planButtons = document.querySelectorAll("[data-plan]")

changeBtn.onclick = () => modal.classList.remove("hidden")
closeBtn.onclick = () => modal.classList.add("hidden")

planButtons.forEach(btn => {
  btn.onclick = () => {
    const plan = btn.dataset.plan
    document.getElementById("currentPlan").innerText = plan
    localStorage.setItem("prooflink_plan", plan)
    modal.classList.add("hidden")
    alert("Plan changed to " + plan)
  }
})

window.addEventListener("load", () => {
  const stored = localStorage.getItem("prooflink_plan")
  if(stored){
    document.getElementById("currentPlan").innerText = stored
  }
})
