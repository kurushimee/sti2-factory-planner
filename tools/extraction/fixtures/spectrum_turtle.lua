local cluster = "spectrum:iron_cluster"
local harvest = "spectrum:pure_iron"

while true do
    turtle.select(1)
    if turtle.suckUp(1) then
        assert(turtle.dropDown(1))
        while true do
            local found, block = turtle.inspectDown()
            if found and block.name == cluster then break end
            sleep(0.05)
        end
        assert(turtle.digDown())
        for slot = 1, 16 do
            local item = turtle.getItemDetail(slot)
            if item and item.name == harvest then
                turtle.select(slot)
                assert(turtle.drop())
            end
        end
    else
        sleep(0.25)
    end
end
